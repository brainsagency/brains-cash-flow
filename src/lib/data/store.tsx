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
import {
  addDays,
  isValidISODate,
  staffToPayroll,
  terminationFinalPay,
  type CashEvent,
  type ForecastInput,
  type Scenario,
  type StaffMember,
} from "@engine/index.js";
import { todayISO } from "@/lib/format.js";
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
 * The next `count` semi-monthly paydays (the 1st and 15th of each month)
 * strictly after `after`. Matches the roster's payroll cadence, so severance
 * kept "on payroll" lands on the same days as a normal paycheck.
 */
function nextSemiMonthlyPaydays(after: string, count: number): string[] {
  const out: string[] = [];
  let [y, m] = after.slice(0, 7).split("-").map(Number) as [number, number];
  while (out.length < count) {
    for (const day of [1, 15]) {
      const d = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (d > after && out.length < count) out.push(d);
    }
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Per-item annotation on any synced ledger event, keyed by the event id
 * (`qbo-inv-…` for invoices, `bill-…` for bills), so it survives every
 * re-sync. `excluded` drops the item from the forecast (e.g. a disputed
 * invoice, or a production/passthrough bill for the sister company); `date`
 * overrides the cash date — the expected collection date for AR, or the
 * planned pay date for AP — when it differs from the invoice/bill due date.
 */
export interface Adjustment {
  excluded?: boolean;
  date?: string;
  /** @deprecated read-only back-compat for AP data stored before the rename. */
  payDate?: string;
}

interface AppState {
  input: ForecastInput; // the MANUAL layer
  scenarios: Scenario[];
  prefs: UiPrefs;
  adjustments: Record<string, Adjustment>;
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
  /** Raw synced AR / AP events (before exclusions/overrides) for the ledgers. */
  syncedArRaw: CashEvent[] | null;
  syncedApRaw: CashEvent[] | null;
  adjustments: Record<string, Adjustment>;
  /** Patch a synced item's adjustment; `date: null` clears the override. */
  setAdjustment: (id: string, patch: { excluded?: boolean; date?: string | null }) => void;
  setInput: (updater: (prev: ForecastInput) => ForecastInput) => void;
  setScenarios: (updater: (prev: Scenario[]) => Scenario[]) => void;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  reset: () => void;
  refreshQbo: () => Promise<void>;
  refreshBill: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

function initialState(): AppState {
  return { input: SEED_INPUT, scenarios: SEED_SCENARIOS, prefs: DEFAULT_PREFS, adjustments: {} };
}

/**
 * The forecast always starts "now": if a stored anchor trails today (a prior
 * day/session), roll it forward. Starting cash is dated separately
 * (balanceAsOf) and prompted for refresh via the reconcile banner.
 */
function withCurrentAnchor(input: ForecastInput): ForecastInput {
  const today = todayISO();
  return input.anchorDate < today ? { ...input, anchorDate: today } : input;
}

// AR invoice categories that QuickBooks owns when connected.
const QBO_AR_CATEGORIES = new Set(["currentAR", "overdueAR"]);
// AP categories that Bill.com owns when synced (apEstimate stays manual).
const BILL_AP_CATEGORIES = new Set(["accountsPayable"]);

interface CloudDoc {
  input: ForecastInput | null;
  scenarios?: Scenario[];
  adjustments?: Record<string, Adjustment>;
  /** Server version stamp, used for optimistic-concurrency saves. */
  updatedAt?: string | null;
}

type SaveResult =
  | { status: "ok"; updatedAt: string | null }
  | { status: "conflict"; current: CloudDoc }
  | { status: "error" };

function readLocal(): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppState>) : null;
  } catch {
    return null;
  }
}

function saveBody(
  state: Pick<AppState, "input" | "scenarios" | "adjustments">,
  baseUpdatedAt: string | null,
): string {
  return JSON.stringify({
    input: state.input,
    scenarios: state.scenarios,
    adjustments: state.adjustments,
    baseUpdatedAt,
  });
}

async function putCloud(
  state: Pick<AppState, "input" | "scenarios" | "adjustments">,
  baseUpdatedAt: string | null,
): Promise<SaveResult> {
  try {
    const res = await fetch("/api/app-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: saveBody(state, baseUpdatedAt),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { current?: CloudDoc };
      return body.current
        ? { status: "conflict", current: body.current }
        : { status: "error" };
    }
    if (!res.ok) return { status: "error" };
    const body = (await res.json().catch(() => ({}))) as { updatedAt?: string | null };
    return { status: "ok", updatedAt: body.updatedAt ?? null };
  } catch {
    return { status: "error" };
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
  // Optimistic-concurrency + reliable-save bookkeeping (all refs so they're
  // current inside async saves and window event handlers without re-rendering).
  const baseUpdatedAtRef = useRef<string | null>(null); // last server version we've seen
  const stateRef = useRef<AppState>(state); // latest state for flush-on-hide
  const dirtyRef = useRef(false); // an unsaved cloud change is pending
  const suppressSaveRef = useRef(false); // skip the cloud save for a programmatic adopt
  stateRef.current = state;

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
            baseUpdatedAtRef.current = doc.updatedAt ?? null;
            next = {
              input: doc.input,
              scenarios: doc.scenarios ?? [],
              adjustments: doc.adjustments ?? {},
              prefs,
            };
          } else {
            // First cloud run: adopt this browser's data (or the seed) and push it up.
            const base = ls?.input
              ? { input: ls.input, scenarios: ls.scenarios ?? [], adjustments: ls.adjustments ?? {} }
              : { input: SEED_INPUT, scenarios: SEED_SCENARIOS, adjustments: {} };
            next = { ...base, prefs };
            const res2 = await putCloud(base, null);
            if (res2.status === "ok") baseUpdatedAtRef.current = res2.updatedAt;
          }
        }
      } catch {
        /* route unreachable — stay local */
      }

      if (!next) {
        next = ls?.input
          ? { input: ls.input, scenarios: ls.scenarios ?? [], adjustments: ls.adjustments ?? {}, prefs }
          : { ...initialState(), prefs };
      }
      const rolled = withCurrentAnchor(next.input);
      const anchorRolled = rolled !== next.input;
      next = { ...next, input: rolled };
      // Skip the redundant cloud write the persist effect would otherwise fire
      // for freshly-loaded data — unless we rolled the anchor forward, which is
      // a real change worth persisting (and safe now, carrying the loaded base).
      suppressSaveRef.current = mode === "cloud" && !anchorRolled;
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

  // Replace the local workspace with the server's copy (a newer version another
  // session saved). Marked to suppress the write the resulting state change
  // would otherwise trigger — we just took this from the server. Prefs are
  // personal (localStorage) and left alone.
  const adoptServer = useCallback((doc: CloudDoc) => {
    if (!doc.input) return;
    baseUpdatedAtRef.current = doc.updatedAt ?? baseUpdatedAtRef.current;
    dirtyRef.current = false;
    suppressSaveRef.current = true;
    setState((s) => ({
      ...s,
      input: withCurrentAnchor(doc.input!),
      scenarios: doc.scenarios ?? [],
      adjustments: doc.adjustments ?? {},
    }));
  }, []);

  // Push the latest snapshot to the cloud with the optimistic-concurrency base.
  // On a conflict (a fresher save landed since we loaded) we rebase onto the
  // server's copy instead of clobbering it — the fix for a stale tab reverting
  // another session's edits.
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const res = await putCloud(stateRef.current, baseUpdatedAtRef.current);
    if (res.status === "ok") {
      dirtyRef.current = false;
      baseUpdatedAtRef.current = res.updatedAt;
    } else if (res.status === "conflict") {
      adoptServer(res.current);
    }
    // error → leave dirty; the next change or window-focus refetch will retry.
  }, [adoptServer]);

  // Persist on change: localStorage always (offline fallback), cloud debounced.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — non-fatal */
    }
    if (storageMode !== "cloud") return;
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false; // this state came from load/adopt — don't echo it back
      return;
    }
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, ready, storageMode, flushSave]);

  // Converge open tabs: when this tab regains focus / becomes visible, pull the
  // latest cloud version. Adopt it only if it's newer AND we have no unsaved
  // local edit in flight (never stomp the user's own pending work — that save
  // will go out and resolve any conflict on its own).
  useEffect(() => {
    if (!ready || storageMode !== "cloud") return;
    const refetch = async () => {
      if (dirtyRef.current) return;
      try {
        const res = await fetch("/api/app-state", { cache: "no-store" });
        if (!res.ok) return;
        const doc = (await res.json()) as CloudDoc;
        if (doc.input && doc.updatedAt && doc.updatedAt !== baseUpdatedAtRef.current) {
          adoptServer(doc);
        }
      } catch {
        /* offline — keep what we have */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, storageMode, adoptServer]);

  // Reliable last-mile save: if the tab is hidden/closed with a pending change,
  // flush it immediately with a keepalive request so a confirm-then-close
  // within the debounce window still reaches the cloud. Best-effort (the
  // debounced save and localStorage remain the primary paths).
  useEffect(() => {
    if (!ready || storageMode !== "cloud") return;
    const flushBeacon = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      try {
        void fetch("/api/app-state", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: saveBody(stateRef.current, baseUpdatedAtRef.current),
          keepalive: true,
        });
      } catch {
        /* nothing more we can do on unload */
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushBeacon();
    };
    window.addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushBeacon);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [ready, storageMode]);

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
  const setAdjustment = useCallback(
    (id: string, patch: { excluded?: boolean; date?: string | null }) =>
      setState((s) => {
        const cur: Adjustment = { ...(s.adjustments[id] ?? {}) };
        if (patch.excluded !== undefined) cur.excluded = patch.excluded;
        if (patch.date !== undefined) {
          if (patch.date === null) delete cur.date;
          else cur.date = patch.date;
        }
        return { ...s, adjustments: { ...s.adjustments, [id]: cur } };
      }),
    [],
  );
  const reset = useCallback(() => setState(initialState()), []);

  // Staff-expanded base: when a roster is present it is the authoritative
  // payroll source — expand it into payroll streams that supersede any manual
  // `payroll` recurring items, plus a one-off severance disbursement on each
  // termination date. No roster → the manual payroll line stands.
  const staffBase = useMemo<ForecastInput>(() => {
    // Sanitize before touching the engine: a member is only expandable once its
    // hire date is a complete, valid YYYY-MM-DD. While someone types a date by
    // hand the field is briefly incomplete, so skip those rows (they stay
    // editable) rather than feeding "" to the date math, which would throw.
    const staff = (state.input.staff ?? [])
      .filter((m) => isValidISODate(m.doh))
      .map((m): StaffMember => ({
        ...m,
        dot: m.dot && isValidISODate(m.dot) ? m.dot : undefined,
        salaryChangeDate:
          m.salaryChangeDate && isValidISODate(m.salaryChangeDate) ? m.salaryChangeDate : undefined,
      }));
    if (staff.length === 0) return state.input;

    const payroll = staffToPayroll(staff, {
      loadFactor: state.input.staffLoadFactor ?? 1,
      defaultBasis: "committed",
    });
    const recurring = [
      ...(state.input.recurring ?? []).filter((r) => r.category !== "payroll"),
      ...payroll,
    ];
    const severance: CashEvent[] = [];
    for (const m of staff) {
      if (!m.dot || !m.severance || m.severance <= 0) continue;
      const semiGross = m.annualSalary / 24; // normal semi-monthly gross paycheck
      // "payroll" = spread the severance across normal paydays at the usual
      // paycheck amount until it's exhausted (final run is the remainder). Falls
      // back to a lump if there's no salary to pace it against.
      if (m.severancePayout === "payroll" && semiGross > 0) {
        const runs = Math.ceil(m.severance / semiGross);
        const days = nextSemiMonthlyPaydays(m.dot, runs);
        let remaining = m.severance;
        days.forEach((date, i) => {
          const amount = Math.min(remaining, semiGross);
          remaining -= amount;
          severance.push({
            id: `staff-sev:${m.id}:${i}`,
            category: "payroll",
            amount,
            date,
            basis: "committed",
            memo: `Severance (payroll ${i + 1}/${runs}): ${m.name}`,
          });
        });
      } else {
        severance.push({
          id: `staff-sev:${m.id}`,
          category: "payroll",
          amount: m.severance,
          date: m.dot,
          basis: "committed",
          memo: `Severance: ${m.name}`,
        });
      }
    }
    const vacationPayout: CashEvent[] = staff
      .filter((m) => m.dot && m.vacationPayout && m.vacationPayout > 0)
      .map((m) => ({
        id: `staff-vac:${m.id}`,
        category: "payroll",
        amount: m.vacationPayout!,
        date: m.dot!,
        basis: "committed",
        memo: `Vacation payout: ${m.name}`,
      }));

    // Final salary: a mid-period termination is paid the balance owed for the
    // days worked in that last partial period, on the term date itself — rather
    // than dropping it (the next regular payday falls after the cutoff).
    const load = state.input.staffLoadFactor ?? 1;
    const finalPay: CashEvent[] = [];
    for (const m of staff) {
      if (!m.dot) continue;
      const salaryAtDot =
        m.salaryChangeDate && m.newSalary !== undefined && m.dot >= m.salaryChangeDate
          ? m.newSalary
          : m.annualSalary;
      const amount = terminationFinalPay(salaryAtDot, m.dot, load);
      if (amount <= 0) continue;
      finalPay.push({
        id: `staff-finalpay:${m.id}`,
        category: "payroll",
        amount,
        date: m.dot,
        basis: "committed",
        memo: `Final salary (partial period): ${m.name}`,
      });
    }

    return {
      ...state.input,
      recurring,
      events: [...(state.input.events ?? []), ...severance, ...vacationPayout, ...finalPay],
    };
  }, [state.input]);

  // Merge: synced QuickBooks AR replaces manual current/overdue AR; synced
  // Bill.com AP replaces manual accountsPayable (apEstimate stays manual).
  // Per-item adjustments apply to both: excluded items drop from the forecast;
  // a date override moves the cash date (collection for AR, payment for AP),
  // clamped to the anchor so a past date can't fall out of the horizon.
  const mergedInput = useMemo<ForecastInput>(() => {
    const hasAr = syncedAr && syncedAr.length > 0;
    const hasAp = syncedAp && syncedAp.length > 0;
    if (!hasAr && !hasAp) return staffBase;
    let events = staffBase.events ?? [];
    if (hasAr) events = events.filter((e) => !QBO_AR_CATEGORIES.has(e.category));
    if (hasAp) events = events.filter((e) => !BILL_AP_CATEGORIES.has(e.category));

    const anchor = staffBase.anchorDate;
    const clampToAnchor = (d: string) => (d < anchor ? anchor : d);
    // AR collection lag: shift receipts past their due date (clients rarely pay
    // on time). Applied only to AR, and only when the invoice has no explicit
    // date override.
    const arLag = Math.max(0, Math.round(staffBase.arCollectionLagDays ?? 0));
    const applyAdjustments = (list: CashEvent[], lagDays: number) =>
      list.flatMap((e) => {
        const adj = state.adjustments[e.id ?? ""] ?? {};
        if (adj.excluded) return [];
        const override = adj.date ?? adj.payDate; // payDate = legacy AP field
        if (override) return [{ ...e, date: clampToAnchor(override) }];
        // Lag applies only to not-yet-due invoices (currentAR). Overdue AR is
        // already swept to the anchor (current week) by the sync — it's late,
        // so we assume it lands now, not N days further out.
        if (lagDays > 0 && e.category === "currentAR") {
          return [{ ...e, date: clampToAnchor(addDays(e.date, lagDays)) }];
        }
        return [e];
      });

    return {
      ...staffBase,
      events: [
        ...events,
        ...applyAdjustments(hasAr ? syncedAr : [], arLag),
        ...applyAdjustments(hasAp ? syncedAp : [], 0),
      ],
    };
  }, [staffBase, state.adjustments, syncedAr, syncedAp]);

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
        syncedArRaw: syncedAr,
        syncedApRaw: syncedAp,
        adjustments: state.adjustments,
        setAdjustment,
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
