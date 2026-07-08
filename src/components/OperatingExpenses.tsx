"use client";

import { useState } from "react";
import type { RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Dedicated editor for recurring operating expenses (Rippling, insurance,
 * utilities, etc.). Each is a monthly (on a day-of-month) or weekly recurring
 * cash-out. The day-of-month is encoded in the item's startDate so the engine
 * lands each payment on the right day.
 *
 * Bills paid through Bill.com (e.g. rent) belong in the AP feed, not here —
 * adding them would double-count.
 */

const OPEX = "operatingExpense" as const;

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

/** Cadence description for the read view, e.g. "Monthly · 3rd" or "Weekly". */
function cadence(item: RecurringItem): string {
  if (item.frequency === "monthly") return `Monthly · ${ordinal(dayOf(item.startDate))}`;
  return FREQ_LABEL[item.frequency];
}

export function OperatingExpenses() {
  const { input, setInput } = useStore();
  const anchorPrefix = input.anchorDate.slice(0, 7);
  const [editing, setEditing] = useState(false);

  const items = (input.recurring ?? []).filter((r) => r.category === OPEX);
  const others = (input.recurring ?? []).filter((r) => r.category !== OPEX);

  const write = (next: RecurringItem[]) => setInput((prev) => ({ ...prev, recurring: [...others, ...next] }));
  const update = (i: number, patch: Partial<RecurringItem>) =>
    write(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => write(items.filter((_, idx) => idx !== i));
  const add = () =>
    write([
      ...items,
      { id: `opex-${Date.now()}`, category: OPEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-01`, basis: "committed", memo: "" },
    ]);

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
        Recurring operating costs (payroll and AmEx are tracked separately). Bills paid through Bill.com — like rent —
        belong in Bills to Pay, not here, or they&apos;d be double-counted.
      </div>

      {items.length === 0 && (
        <div className="muted" style={{ marginBottom: 12 }}>No operating expenses yet — add your first below.</div>
      )}

      {/* Read view */}
      {!editing &&
        items.map((it) => (
          <div className="spec-row" key={it.id}>
            <span className="label">
              {it.memo || <span className="muted">Unnamed expense</span>}
              <span className="meta">{cadence(it)}</span>
            </span>
            <span className="val mono">{fmtMoney(it.amount, { cents: true })}</span>
          </div>
        ))}

      {/* Edit view */}
      {editing &&
        items.map((it, i) => (
          <div
            key={it.id ?? i}
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
              {it.frequency === "monthly" ? (
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
              <label>Amount</label>
              <MoneyInput value={it.amount} step="0.01" onChange={(n) => update(i, { amount: n })} />
            </div>
            <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">✕</button>
          </div>
        ))}

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
