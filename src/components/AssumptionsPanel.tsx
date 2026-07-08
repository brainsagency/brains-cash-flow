"use client";

import { type ForecastInput } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { daysAgo, fmtShortDate, todayISO } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Assumptions & settings — deliberately lean. Everything with a dedicated tab
 * lives there now (AR → Invoices, AP → Bills, payroll → Staff Roster, opex &
 * AmEx → Operating Expenses, manual cash-outs → Other Withdrawals, deals →
 * New Business). What remains here is what has no other home: the forecast
 * anchor, burn/reserve/runway thresholds, and the manually-entered bank
 * balances that seed the whole projection.
 */
export function AssumptionsPanel() {
  const { input, setInput, storageMode } = useStore();
  const patch = (p: Partial<ForecastInput>) => setInput((prev) => ({ ...prev, ...p }));

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Assumptions &amp; settings</h2>
        <div className="spacer" />
        <span className={`chip ${storageMode === "cloud" ? "committed" : "budgeted"}`}>
          {storageMode === "cloud" ? "shared workspace" : "this browser only"}
        </span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Global forecast settings and bank balances. Everything else — invoices, bills, payroll, expenses, and new
        business — is edited on its own tab.
      </div>

      {storageMode === "local" && (
        <div className="alert warning" style={{ marginBottom: 14 }}>
          <span className="ico">🟡</span>
          <span>
            Changes save to <b>this browser only</b>. Run the <code>app_state</code> table SQL in Supabase to enable
            the shared cloud workspace.
          </span>
        </div>
      )}

      <Settings anchorDate={input.anchorDate} onPatch={patch} />
      <BankAccounts />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Settings({ anchorDate, onPatch }: { anchorDate: string; onPatch: (p: Partial<ForecastInput>) => void }) {
  const { input, setInput } = useStore();
  const s = input.settings ?? { reserveMultiple: 3, runwayAlertMonths: 6, largeOverdueARThreshold: 50_000 };
  const set = (p: Partial<typeof s>) => setInput((prev) => ({ ...prev, settings: { ...s, ...p } }));

  return (
    <Group title="Forecast settings">
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ width: 150 }}>
          <label>Anchor date (&ldquo;today&rdquo;)</label>
          <input type="date" value={anchorDate} onChange={(e) => e.target.value && onPatch({ anchorDate: e.target.value })} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>Monthly burn override</label>
          <input
            type="number"
            value={s.monthlyBurnOverride ?? ""}
            placeholder="auto (computed)"
            onChange={(e) => set({ monthlyBurnOverride: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Reserve multiple</label>
          <input type="number" value={s.reserveMultiple} onChange={(e) => set({ reserveMultiple: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>Runway alert (months)</label>
          <input type="number" value={s.runwayAlertMonths} onChange={(e) => set({ runwayAlertMonths: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ width: 190 }}>
          <label>AR collection lag (days)</label>
          <input
            type="number"
            min={0}
            value={input.arCollectionLagDays ?? 0}
            onChange={(e) => onPatch({ arCollectionLagDays: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Collection lag shifts every synced invoice this many days past its due date — clients rarely pay on time.
        Per-invoice date overrides (set on the Invoices tab) still win. 0 = assume paid on the due date.
      </div>
    </Group>
  );
}

const STALE_BALANCE_DAYS = 10;

function BankAccounts() {
  const { input, setInput } = useStore();
  const update = (id: string, p: Partial<(typeof input.bankAccounts)[number]>) =>
    setInput((prev) => ({
      ...prev,
      bankAccounts: prev.bankAccounts.map((a) => (a.id === id ? { ...a, ...p } : a)),
    }));
  // Editing a balance stamps it as updated today.
  const setBalance = (id: string, value: number) => update(id, { beginningBalance: value, balanceAsOf: todayISO() });

  return (
    <Group title="Bank accounts (which count toward operating cash)">
      {input.bankAccounts.map((a) => {
        const age = a.balanceAsOf ? daysAgo(a.balanceAsOf) : null;
        const stale = age !== null && age >= STALE_BALANCE_DAYS;
        return (
          <div className="row" key={a.id} style={{ marginBottom: 6 }}>
            <div style={{ width: 150 }}>
              {a.name}
              {a.mask ? ` …${a.mask}` : ""}
            </div>
            <div style={{ width: 150 }}>
              <MoneyInput value={a.beginningBalance} step="0.01" onChange={(n) => setBalance(a.id, n)} />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={a.operating !== false} onChange={(e) => update(a.id, { operating: e.target.checked })} />
              operating
            </label>
            <span className={`chip ${stale ? "danger" : "neutral"}`} style={{ marginLeft: 4 }}>
              {a.balanceAsOf ? `as of ${fmtShortDate(a.balanceAsOf)}${stale ? ` · ${age}d old` : ""}` : "no date"}
            </span>
          </div>
        );
      })}
      <div className="muted" style={{ marginTop: 8 }}>
        Editing a balance stamps it as updated today. Update these when you reconcile — balances older than{" "}
        {STALE_BALANCE_DAYS} days are flagged.
      </div>
    </Group>
  );
}
