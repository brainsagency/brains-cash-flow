"use client";

import { useState } from "react";
import type { CashCategory, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Editor for recurring operating costs — operating expenses (Rippling,
 * insurance, utilities) and the AmEx card. Each is a monthly (on a
 * day-of-month) or weekly recurring cash-out.
 *
 * Variable monthly costs (like AmEx) carry a budget amount plus per-month
 * actual overrides: budget a placeholder, then fill in the real number as each
 * month closes. The override supersedes the budget for that month only.
 *
 * Bills paid through Bill.com (e.g. rent) belong in the AP feed, not here —
 * adding them would double-count.
 */

const OPEX = "operatingExpense" as const;
// Categories this tab owns (kept distinct so the forecast breakdown still
// shows AmEx on its own row).
const MANAGED = new Set<CashCategory>([OPEX, "amex"]);

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
};

function dayOf(startDate: string): number {
  return Number(startDate.slice(8, 10)) || 1;
}
function withDay(startDate: string, day: number): string {
  const d = Math.min(31, Math.max(1, Math.floor(day) || 1));
  return `${startDate.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
/** Monthly-equivalent amount for the total (weekly ≈ 52/12 per month). */
function monthlyEquivalent(item: RecurringItem): number {
  switch (item.frequency) {
    case "weekly":
      return (item.amount * 52) / 12;
    case "biweekly":
      return (item.amount * 26) / 12;
    case "semimonthly":
      return item.amount * 2;
    case "monthly":
      return item.amount;
  }
}

function cadence(item: RecurringItem): string {
  if (item.frequency === "monthly") return `Monthly · ${ordinal(dayOf(item.startDate))}`;
  return FREQ_LABEL[item.frequency];
}

/** Sorted [month, amount] entries for an item's overrides. */
function overrideEntries(item: RecurringItem): Array<[string, number]> {
  return Object.entries(item.overrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

export function OperatingExpenses() {
  const { input, setInput } = useStore();
  const anchorPrefix = input.anchorDate.slice(0, 7);
  const [editing, setEditing] = useState(false);
  const [openActuals, setOpenActuals] = useState<Record<string, boolean>>({});

  const items = (input.recurring ?? []).filter((r) => MANAGED.has(r.category));
  const others = (input.recurring ?? []).filter((r) => !MANAGED.has(r.category));

  const write = (next: RecurringItem[]) => setInput((prev) => ({ ...prev, recurring: [...others, ...next] }));
  const update = (i: number, patch: Partial<RecurringItem>) =>
    write(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => write(items.filter((_, idx) => idx !== i));
  const add = () =>
    write([
      ...items,
      { id: `opex-${Date.now()}`, category: OPEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-01`, basis: "committed", memo: "" },
    ]);

  // Per-month actual overrides.
  const writeOverrides = (i: number, entries: Array<[string, number]>) => {
    const rec: Record<string, number> = {};
    for (const [m, v] of entries) if (m) rec[m] = v;
    update(i, { overrides: Object.keys(rec).length ? rec : undefined });
  };
  const setOverrideMonth = (i: number, idx: number, month: string) => {
    const e = overrideEntries(items[i]!);
    if (e[idx]) e[idx] = [month, e[idx]![1]];
    writeOverrides(i, e);
  };
  const setOverrideAmount = (i: number, idx: number, amount: number) => {
    const e = overrideEntries(items[i]!);
    if (e[idx]) e[idx] = [e[idx]![0], amount];
    writeOverrides(i, e);
  };
  const removeOverride = (i: number, idx: number) => {
    const e = overrideEntries(items[i]!);
    e.splice(idx, 1);
    writeOverrides(i, e);
  };
  const addOverride = (i: number) => {
    const it = items[i]!;
    const e = overrideEntries(it);
    // Default to the first month not already overridden, starting at the anchor.
    const used = new Set(e.map(([m]) => m));
    let month = `${anchorPrefix}`;
    for (let k = 0; k < 24 && used.has(month); k++) {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const nm = m === 12 ? 1 : m + 1;
      const ny = m === 12 ? y + 1 : y;
      month = `${ny}-${String(nm).padStart(2, "0")}`;
    }
    e.push([month, it.amount]);
    writeOverrides(i, e);
  };

  const monthlyTotal = items.reduce((s, it) => s + monthlyEquivalent(it), 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Operating Expenses</h2>
        <div className="spacer" />
        <span className="pill-total mono" style={{ marginRight: 10 }}>{fmtMoney(monthlyTotal)}/mo</span>
        {items.length > 0 && (
          <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Recurring operating costs, including AmEx (payroll is on the Staff Roster). Variable costs carry a budget
        amount plus per-month <b>actuals</b> — fill in the real number as each month closes. Bills paid through
        Bill.com — like rent — belong in Bills to Pay, or they&apos;d be double-counted.
      </div>

      {items.length === 0 && (
        <div className="muted" style={{ marginBottom: 12 }}>No operating expenses yet — add your first below.</div>
      )}

      {/* Read view */}
      {!editing &&
        items.map((it) => {
          const nOv = overrideEntries(it).length;
          return (
            <div className="spec-row" key={it.id}>
              <span className="label">
                {it.memo || <span className="muted">Unnamed expense</span>}
                <span className="meta">{cadence(it)}</span>
                {nOv > 0 && <span className="meta">· {nOv} actual{nOv === 1 ? "" : "s"}</span>}
              </span>
              <span className="val mono">
                {fmtMoney(it.amount, { cents: true })}
                {nOv > 0 && <span className="sub">budget</span>}
              </span>
            </div>
          );
        })}

      {/* Edit view */}
      {editing &&
        items.map((it, i) => {
          const isMonthly = it.frequency === "monthly";
          const entries = overrideEntries(it);
          const showActuals = openActuals[it.id ?? String(i)] ?? false;
          return (
            <div key={it.id ?? i}>
              <div
                style={{ display: "grid", gridTemplateColumns: "1.8fr 0.9fr 0.7fr 0.9fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}
              >
                <div className="field">
                  <label>Expense</label>
                  <input value={it.memo ?? ""} placeholder="e.g. BlueCrossBlueShield" onChange={(e) => update(i, { memo: e.target.value })} />
                </div>
                <div className="field">
                  <label>Frequency</label>
                  <select value={it.frequency} onChange={(e) => update(i, { frequency: e.target.value as RecurringFrequency })}>
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="semimonthly">Semi-monthly</option>
                  </select>
                </div>
                <div className="field">
                  <label>Day</label>
                  {isMonthly ? (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={dayOf(it.startDate)}
                      onChange={(e) => update(i, { startDate: withDay(it.startDate, Number(e.target.value)) })}
                    />
                  ) : (
                    <input value="—" disabled />
                  )}
                </div>
                <div className="field">
                  <label>{entries.length > 0 ? "Budget" : "Amount"}</label>
                  <MoneyInput value={it.amount} step="0.01" onChange={(n) => update(i, { amount: n })} />
                </div>
                <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">✕</button>
              </div>

              {/* Monthly actuals */}
              {isMonthly && (
                <div style={{ paddingLeft: 2, marginBottom: 10 }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => setOpenActuals((p) => ({ ...p, [it.id ?? String(i)]: !showActuals }))}
                    style={{ fontSize: 12 }}
                  >
                    {showActuals ? "▾" : "▸"} Monthly actuals{entries.length > 0 ? ` (${entries.length})` : ""}
                  </button>
                  {showActuals && (
                    <div className="actuals-panel">
                      <div className="head">
                        Override specific months with actual amounts. Months left blank use the budget
                        ({fmtMoney(it.amount, { cents: true })}).
                      </div>
                      {entries.map(([month, amount], idx) => (
                        <div className="actuals-row" key={idx}>
                          <input type="month" value={month} onChange={(e) => setOverrideMonth(i, idx, e.target.value)} />
                          <MoneyInput value={amount} step="0.01" onChange={(n) => setOverrideAmount(i, idx, n)} />
                          <button className="btn sm ghost" onClick={() => removeOverride(i, idx)} title="Remove actual">✕</button>
                        </div>
                      ))}
                      <button className="btn sm" onClick={() => addOverride(i)} style={{ marginTop: 4 }}>
                        + Add month actual
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

      {editing && (
        <button className="btn sm" onClick={add} style={{ marginTop: 6 }}>
          + Add operating expense
        </button>
      )}
      {!editing && items.length === 0 && (
        <button className="btn sm" onClick={() => { setEditing(true); add(); }} style={{ marginTop: 6 }}>
          + Add operating expense
        </button>
      )}
    </div>
  );
}
