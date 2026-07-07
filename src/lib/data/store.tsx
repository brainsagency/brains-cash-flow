"use client";

/**
 * Client-side store for v1: holds the manual forecast input, saved scenarios,
 * and UI prefs (persisted to localStorage), and overlays live synced AR from
 * QuickBooks on top. Components read the merged `input`; `setInput` edits the
 * manual layer. This is the seam where a Supabase data layer drops in later.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CashEvent, ForecastInput, Scenario } from "@engine/index.js";
import { SEED_INPUT, SEED_SCENARIOS } from "./seed.js";

const STORAGE_KEY = "brains-cashflow-v2";

export interface UiPrefs {
  view: "week" | "month";
  weekRange: number;
  monthRange: number;
}

const DEFAULT_PREFS: UiPrefs = { view: "week", weekRange: 26, monthRange: 18 };

interface AppState {
  input: ForecastInput; // the MANUAL layer
  scenarios: Scenario[];
  prefs: UiPrefs;
}

interface Store {
  input: ForecastInput; // MERGED (manual + synced AR/AP)
  scenarios: Scenario[];
  prefs: UiPrefs;
  ready: boolean;
  /** When QuickBooks AR is overlaid, the sync timestamp; else null. */
  qboSyncedAt: string | null;
  /** When Bill.com AP is overlaid, the sync timestamp; else null. */
  billSyncedAt: string | null;
  setInput: (updater: (prev: ForecastInput) => ForecastInput) => void;
  setScenarios: (updater: (prev: Scenario[]) => Scenario[]) => void;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  reset: () => void;
  refreshQbo: () => Promise<void>;
  refreshBill: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

function initialState(): AppState {
  return { input: SEED_INPUT, scenarios: SEED_SCENARIOS, prefs: DEFAULT_PREFS };
}

// AR invoice categories that QuickBooks owns when connected.
const QBO_AR_CATEGORIES = new Set(["currentAR", "overdueAR"]);
// AP categories that Bill.com owns when synced (apEstimate stays manual).
const BILL_AP_CATEGORIES = new Set(["accountsPayable"]);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [syncedAr, setSyncedAr] = useState<CashEvent[] | null>(null);
  const [qboSyncedAt, setQboSyncedAt] = useState<string | null>(null);
  const [syncedAp, setSyncedAp] = useState<CashEvent[] | null>(null);
  const [billSyncedAt, setBillSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppState>;
        if (parsed.input) {
          setState({
            input: parsed.input,
            scenarios: parsed.scenarios ?? [],
            prefs: { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) },
          });
        }
      }
    } catch {
      /* corrupt storage — fall back to seed */
    }
    setReady(true);
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
      /* endpoint unavailable (e.g. not deployed) — stay on manual data */
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

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [state, ready]);

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
  const reset = useCallback(() => setState(initialState()), []);

  // Merge: synced QuickBooks AR replaces manual current/overdue AR; synced
  // Bill.com AP replaces manual accountsPayable (apEstimate stays manual).
  const mergedInput = useMemo<ForecastInput>(() => {
    const hasAr = syncedAr && syncedAr.length > 0;
    const hasAp = syncedAp && syncedAp.length > 0;
    if (!hasAr && !hasAp) return state.input;
    let events = state.input.events ?? [];
    if (hasAr) events = events.filter((e) => !QBO_AR_CATEGORIES.has(e.category));
    if (hasAp) events = events.filter((e) => !BILL_AP_CATEGORIES.has(e.category));
    return {
      ...state.input,
      events: [...events, ...(hasAr ? syncedAr : []), ...(hasAp ? syncedAp : [])],
    };
  }, [state.input, syncedAr, syncedAp]);

  return (
    <StoreContext.Provider
      value={{
        input: mergedInput,
        scenarios: state.scenarios,
        prefs: state.prefs,
        ready,
        qboSyncedAt,
        billSyncedAt,
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
