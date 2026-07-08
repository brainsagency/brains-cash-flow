"use client";

import { type CashEvent, type ForecastInput, type RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/categories.js";
import { daysAgo, fmtShortDate, todayISO } from "@/lib/format.js";

export function AssumptionsPanel() {
  const { input, setInput, reset, storageMode } = useStore();

  const patch = (p: Partial<ForecastInput>) => setInput((prev) => ({ ...prev, ...p }));

  return (
    <details className="editor">
      <summary>
        Assumptions &amp; settings
        <span className={`chip ${storageMode === "cloud" ? "committed" : "budgeted"}`} style={{ marginLeft: 8 }}>
          {storageMode === "cloud" ? "shared workspace" : "this browser only"}
        </span>
      </summary>
      <div className="editor-body">
        {storageMode === "local" && (
          <div className="alert warning" style={{ marginBottom: 14 }}>
            <span className="ico">🟡</span>
            <span>
              Changes save to <b>this browser only</b>. Run the <code>app_state</code> table SQL in Supabase to
              enable the shared cloud workspace.
            </span>
          </div>
        )}
        {/* toggles */}
        <div className="row" style={{ gap: 20, marginBottom: 18 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={input.includePipeline ?? false}
              onChange={(e) => patch({ includePipeline: e.target.checked })}
            />
            Include pipeline
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={input.includeBudgeted ?? false}
              onChange={(e) => patch({ includeBudgeted: e.target.checked })}
            />
            Include budgeted (model plan)
          </label>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Anchor date</label>
            <input
              type="date"
              value={input.anchorDate}
              onChange={(e) => e.target.value && patch({ anchorDate: e.target.value })}
            />
          </div>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={reset}>
            Reset to sample
          </button>
        </div>

        <BankAccounts />
        <Settings />
        <ItemList kind="recurring" />
        <ItemList kind="events" />
      </div>
    </details>
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
    <Group title="Bank accounts (manually entered — which count toward operating cash)">
      {input.bankAccounts.map((a) => {
        const age = a.balanceAsOf ? daysAgo(a.balanceAsOf) : null;
        const stale = age !== null && age >= STALE_BALANCE_DAYS;
        return (
          <div className="row" key={a.id} style={{ marginBottom: 6 }}>
            <div style={{ width: 150 }}>
              {a.name}
              {a.mask ? ` …${a.mask}` : ""}
            </div>
            <div className="field" style={{ width: 150 }}>
              <input
                type="number"
                value={a.beginningBalance}
                onChange={(e) => setBalance(a.id, Number(e.target.value))}
              />
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={a.operating !== false}
                onChange={(e) => update(a.id, { operating: e.target.checked })}
              />
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

function Settings() {
  const { input, setInput } = useStore();
  const s = input.settings ?? {
    reserveMultiple: 3,
    runwayAlertMonths: 6,
    largeOverdueARThreshold: 50_000,
  };
  const set = (p: Partial<typeof s>) => setInput((prev) => ({ ...prev, settings: { ...s, ...p } }));

  return (
    <Group title="Settings">
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ width: 170 }}>
          <label>Monthly burn override</label>
          <input
            type="number"
            value={s.monthlyBurnOverride ?? ""}
            placeholder="auto (computed)"
            onChange={(e) =>
              set({ monthlyBurnOverride: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Reserve multiple</label>
          <input
            type="number"
            value={s.reserveMultiple}
            onChange={(e) => set({ reserveMultiple: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>Runway alert (months)</label>
          <input
            type="number"
            value={s.runwayAlertMonths}
            onChange={(e) => set({ runwayAlertMonths: Number(e.target.value) })}
          />
        </div>
      </div>
    </Group>
  );
}

function ItemList({ kind }: { kind: "recurring" | "events" }) {
  const { input, setInput } = useStore();
  const items = (kind === "recurring" ? input.recurring : input.events) ?? [];

  const write = (next: (RecurringItem | CashEvent)[]) =>
    setInput((prev) => ({ ...prev, [kind]: next }) as ForecastInput);

  const update = (i: number, p: Record<string, unknown>) =>
    write(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  const remove = (i: number) => write(items.filter((_, idx) => idx !== i));
  const add = () =>
    write([
      ...items,
      kind === "recurring"
        ? ({ category: "operatingExpense", amount: 0, frequency: "monthly", startDate: input.anchorDate } as RecurringItem)
        : ({ category: "currentAR", amount: 0, date: input.anchorDate } as CashEvent),
    ]);

  return (
    <Group title={kind === "recurring" ? "Recurring items" : "One-off events (AR / AP / withdrawals)"}>
      {items.map((it, i) => (
        <div className="item-grid" key={i}>
          <div className="field">
            <label>Category</label>
            <select value={it.category} onChange={(e) => update(i, { category: e.target.value })}>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              value={it.amount}
              onChange={(e) => update(i, { amount: Number(e.target.value) })}
            />
          </div>
          {kind === "recurring" ? (
            <div className="field">
              <label>Frequency</label>
              <select
                value={(it as RecurringItem).frequency}
                onChange={(e) => update(i, { frequency: e.target.value })}
              >
                {["weekly", "biweekly", "semimonthly", "monthly"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field">
              <label>Date</label>
              <input
                type="date"
                value={(it as CashEvent).date}
                onChange={(e) => update(i, { date: e.target.value })}
              />
            </div>
          )}
          <div className="field">
            <label>{kind === "recurring" ? "Start" : "Basis"}</label>
            {kind === "recurring" ? (
              <input
                type="date"
                value={(it as RecurringItem).startDate}
                onChange={(e) => update(i, { startDate: e.target.value })}
              />
            ) : (
              <select
                value={(it as CashEvent).basis ?? "committed"}
                onChange={(e) => update(i, { basis: e.target.value })}
              >
                <option value="committed">committed</option>
                <option value="budgeted">budgeted</option>
              </select>
            )}
          </div>
          <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={add} style={{ marginTop: 6 }}>
        + Add {kind === "recurring" ? "recurring item" : "event"}
      </button>
    </Group>
  );
}
