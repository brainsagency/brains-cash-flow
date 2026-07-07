"use client";

/**
 * Client-side store: the manual forecast layer, saved scenarios, and per-bill
 * AP adjustments, plus per-browser UI prefs — with live synced AR/AP overlaid.
 *
 * Storage:
 *  - Cloud (Supabase via /api/app-state) when available — one shared workspace
 *    document so the whole team sees the same assumptions. Saves are debounced;
 *    last write wins.
 *  - localStorage fallback when the cloud route is unavailable (Supabase not
 *    configured / table missing). On the first cloud load, any existing
 *    localStorage data is migrated up automatically.
 *  - UI prefs stay in localStorage on purpose (view/range are personal).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CashEvent, ForecastInput, Scenario } from "@engine/index.js";
import { SEED_INPUT, SEED_SCENARIOS } from "./seed.js";

const STORAGE_KEY = "brains-cashflow-v2";
const SAVE_DEBOUNCE_MS = 800;

export interface UiPrefs {
  view: "week" | "month";
  weekRange: number;
  monthRange: number;
}

const DEFAULT_PREFS: UiPrefs = { view: "week", weekRange: 26, monthRange: 18 };

/**
 * Per-bill annotation on synced AP, keyed by the event id (`bill-…`), so it
 * survives every re-sync. `excluded` drops the bill from the forecast (e.g.
 * production/passthrough bills for the sister company); `payDate` overrides
 * when the cash actually leaves (planned pay date vs the bill's due date).
 */
export interface ApAdjustment {
  excluded?: boolean;
  payDate?: string;
}

interface AppState {
  input: ForecastInput; // the MANUAL layer
  scenarios: Scenario[];
  prefs: UiPrefs;
  apAdjustments: Record<string, ApAdjustment>;
}

export type StorageMode = "cloud" | "local";

interface Store {
  input: ForecastInput; // MERGED (manual + synced AR/AP)
  scenarios: Scenario[];
  prefs: UiPrefs;
  ready: boolean;
  /** Where manual data persists: shared cloud workspace or this browser only. */
  storageMode: StorageMode;
  /** When QuickBooks AR is overlaid, the sync timestamp; else null. */
  qboSyncedAt: string | null;
  /** When Bill.com AP is overlaid, the sync timestamp; else null. */
  billSyncedAt: string | null;
  /** Raw synced AP events (before exclusions/overrides) for the AP ledger. */
  syncedApRaw: CashEvent[] | null;
  apAdjustments: Record<string, ApAdjustment>;
  /** Patch a bill's adjustment; `payDate: null` clears the override. */
  setApAdjustment: (id: string, patch: { excluded?: boolean; payDate?: string | null }) => void;
  setInput: (updater: (prev: ForecastInput) => ForecastInput) => void;
  setScenarios: (updater: (prev: Scenario[]) => Scenario[]) => void;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  reset: () => void;
  refreshQbo: () => Promise<void>;
  refreshBill: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

function initialState(): AppState {
  return { input: SEED_INPUT, scenarios: SEED_SCENARIOS, prefs: DEFAULT_PREFS, apAdjustments: {} };
}

// AR invoice categories that QuickBooks owns when connected.
const QBO_AR_CATEGORIES = new Set(["currentAR", "overdueAR"]);
// AP categories that Bill.com owns when synced (apEstimate stays manual).
const BILL_AP_CATEGORIES = new Set(["accountsPayable"]);

interface CloudDoc {
  input: ForecastInput | null;
  scenarios?: Scenario[];
  apAdjustments?: Record<string, ApAdjustment>;
}

function readLocal(): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppState>) : null;
  } catch {
    return null;
  }
}

async function putCloud(state: Pick<AppState, "input" | "scenarios" | "apAdjustments">): Promise<boolean> {
  try {
    const res = await fetch("/api/app-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: state.input,
        scenarios: state.scenarios,
        apAdjustments: state.apAdjustments,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [syncedAr, setSyncedAr] = useState<CashEvent[] | null>(null);
  const [qboSyncedAt, setQboSyncedAt] = useState<string | null>(null);
  const [syncedAp, setSyncedAp] = useState<CashEvent[] | null>(null);
  const [billSyncedAt, setBillSyncedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load: cloud first; migrate localStorage up on first cloud run; else local.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ls = readLocal();
      const prefs = { ...DEFAULT_PREFS, ...(ls?.prefs ?? {}) };
      let mode: StorageMode = "local";
      let next: AppState | null = null;

      try {
        const res = await fetch("/api/app-state", { cache: "no-store" });
        if (res.ok) {
          mode = "cloud";
          const doc = (await res.json()) as CloudDoc;
          if (doc.input) {
            next = {
              input: doc.input,
              scenarios: doc.scenarios ?? [],
              apAdjustments: doc.apAdjustments ?? {},
              prefs,
            };
          } else {
            // First cloud run: adopt this browser's data (or the seed) and push it up.
            const base = ls?.input
              ? { input: ls.input, scenarios: ls.scenarios ?? [], apAdjustments: ls.apAdjustments ?? {} }
              : { input: SEED_INPUT, scenarios: SEED_SCENARIOS, apAdjustments: {} };
            next = { ...base, prefs };
            void putCloud(base);
          }
        }
      } catch {
        /* route unreachable — stay local */
      }

      if (!next) {
        next = ls?.input
          ? { input: ls.input, scenarios: ls.scenarios ?? [], apAdjustments: ls.apAdjustments ?? {}, prefs }
          : { ...initialState(), prefs };
      }
      if (!cancelled) {
        setState(next);
        setStorageMode(mode);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshQbo = useCallback(async () => {
    try {
      const res = await fetch("/api/qbo/data", { cache: "no-store" });
      const data = (await res.json()) as { syncedAt: string | null; arEvents: CashEvent[] };
      if (data.arEvents && data.arEvents.length > 0) {
        setSyncedAr(data.arEvents);
        setQboSyncedAt(data.syncedAt);
      } else {
        setSyncedAr(null);
        setQboSyncedAt(null);
      }
    } catch {
      /* endpoint unavailable — stay on manual data */
    }
  }, []);

  const refreshBill = useCallback(async () => {
    try {
      const res = await fetch("/api/billdotcom/data", { cache: "no-store" });
      const data = (await res.json()) as { syncedAt: string | null; apEvents: CashEvent[] };
      if (data.apEvents && data.apEvents.length > 0) {
        setSyncedAp(data.apEvents);
        setBillSyncedAt(data.syncedAt);
      } else {
        setSyncedAp(null);
        setBillSyncedAt(null);
      }
    } catch {
      /* endpoint unavailable — stay on manual data */
    }
  }, []);

  useEffect(() => {
    void refreshQbo();
    void refreshBill();
  }, [refreshQbo, refreshBill]);

  // Persist on change: localStorage always (offline fallback), cloud debounced.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — non-fatal */
    }
    if (storageMode !== "cloud") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void putCloud(state);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, ready, storageMode]);

  const setInput = useCallback(
    (updater: (prev: ForecastInput) => ForecastInput) =>
      setState((s) => ({ ...s, input: updater(s.input) })),
    [],
  );
  const setScenarios = useCallback(
    (updater: (prev: Scenario[]) => Scenario[]) => setState((s) => ({ ...s, scenarios: updater(s.scenarios) })),
    [],
  );
  const setPrefs = useCallback(
    (patch: Partial<UiPrefs>) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...patch } })),
    [],
  );
  const setApAdjustment = useCallback(
    (id: string, patch: { excluded?: boolean; payDate?: string | null }) =>
      setState((s) => {
        const cur: ApAdjustment = { ...(s.apAdjustments[id] ?? {}) };
        if (patch.excluded !== undefined) cur.excluded = patch.excluded;
        if (patch.payDate !== undefined) {
          if (patch.payDate === null) delete cur.payDate;
          else cur.payDate = patch.payDate;
        }
        return { ...s, apAdjustments: { ...s.apAdjustments, [id]: cur } };
      }),
    [],
  );
  const reset = useCallback(() => setState(initialState()), []);

  // Merge: synced QuickBooks AR replaces manual current/overdue AR; synced
  // Bill.com AP replaces manual accountsPayable (apEstimate stays manual).
  // Per-bill adjustments apply here: excluded bills drop out of the forecast,
  // planned-pay-date overrides move the cash-out date (clamped to the anchor).
  const mergedInput = useMemo<ForecastInput>(() => {
    const hasAr = syncedAr && syncedAr.length > 0;
    const hasAp = syncedAp && syncedAp.length > 0;
    if (!hasAr && !hasAp) return state.input;
    let events = state.input.events ?? [];
    if (hasAr) events = events.filter((e) => !QBO_AR_CATEGORIES.has(e.category));
    if (hasAp) events = events.filter((e) => !BILL_AP_CATEGORIES.has(e.category));

    const anchor = state.input.anchorDate;
    const adjustedAp = (hasAp ? syncedAp : []).flatMap((e) => {
      const adj = state.apAdjustments[e.id ?? ""] ?? {};
      if (adj.excluded) return [];
      if (adj.payDate) return [{ ...e, date: adj.payDate < anchor ? anchor : adj.payDate }];
      return [e];
    });

    return {
      ...state.input,
      events: [...events, ...(hasAr ? syncedAr : []), ...adjustedAp],
    };
  }, [state.input, state.apAdjustments, syncedAr, syncedAp]);

  return (
    <StoreContext.Provider
      value={{
        input: mergedInput,
        scenarios: state.scenarios,
        prefs: state.prefs,
        ready,
        storageMode,
        qboSyncedAt,
        billSyncedAt,
        syncedApRaw: syncedAp,
        apAdjustments: state.apAdjustments,
        setApAdjustment,
        setInput,
        setScenarios,
        setPrefs,
        reset,
        refreshQbo,
        refreshBill,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}
