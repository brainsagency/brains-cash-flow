"use client";

import { useState } from "react";
import type { CashCategory, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Editor for recurring operating costs.
 *
 * AmEx (category "amex") is the headline variable expense, so it gets its own
 * section with a month-by-month grid: budget a monthly placeholder, then fill
 * in the actual as each month closes (a blank month uses the budget). The
 * plain operating expenses (category "operatingExpense") are a simple list
 * below.
 *
 * Bills paid through Bill.com (e.g. rent) belong in the AP feed, not here —
 * adding them would double-count.
 */

const OPEX = "operatingExpense" as const;
const AMEX = "amex" as const;
const MANAGED = new Set<CashCategory>([OPEX, AMEX]);

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
};
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${MO[(m || 1) - 1]} '${String(y).slice(2)}`;
}
/** `count` calendar months starting at the anchor's month. */
function monthsFrom(anchor: string, count: number): string[] {
  const [y, m] = anchor.slice(0, 7).split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    const mi = m - 1 + k;
    out.push(`${y + Math.floor(mi / 12)}-${String((mi % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

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

export function OperatingExpenses() {
  const { input, setInput } = useStore();
  const anchor = input.anchorDate;
  const anchorPrefix = anchor.slice(0, 7);
  const [editing, setEditing] = useState(false);

  const all = input.recurring ?? [];
  const opex = all.filter((r) => r.category === OPEX);
  const amex = all.filter((r) => r.category === AMEX);

  // All writes rebuild the recurring array, preserving non-managed items.
  const updateItem = (id: string | undefined, patch: Partial<RecurringItem>) =>
    setInput((prev) => ({
      ...prev,
      recurring: (prev.recurring ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const removeItem = (id: string | undefined) =>
    setInput((prev) => ({ ...prev, recurring: (prev.recurring ?? []).filter((r) => r.id !== id) }));
  const addOpex = () =>
    setInput((prev) => ({
      ...prev,
      recurring: [
        ...(prev.recurring ?? []),
        { id: `opex-${Date.now()}`, category: OPEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-01`, basis: "committed", memo: "" },
      ],
    }));
  const addAmex = () =>
    setInput((prev) => ({
      ...prev,
      recurring: [
        ...(prev.recurring ?? []),
        { id: `amex-${Date.now()}`, category: AMEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-06`, basis: "committed", memo: "American Express" },
      ],
    }));

  const setOverride = (item: RecurringItem, ym: string, raw: string) => {
    const ov = { ...(item.overrides ?? {}) };
    if (raw === "") delete ov[ym];
    else ov[ym] = Number(raw);
    updateItem(item.id, { overrides: Object.keys(ov).length ? ov : undefined });
  };

  const months = monthsFrom(anchor, 12);
  const monthlyTotal =
    opex.reduce((s, it) => s + monthlyEquivalent(it), 0) + amex.reduce((s, it) => s + it.amount, 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Operating Expenses</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(monthlyTotal)}/mo</span>
      </div>
      <div className="muted" style={{ marginBottom: 16 }}>
        Recurring operating costs (payroll is on the Staff Roster). Bills paid through Bill.com — like rent — belong in
        Bills to Pay, or they&apos;d be double-counted.
      </div>

      {/* AmEx — variable, with monthly actuals */}
      {amex.map((item) => (
        <div className="amex-section" key={item.id}>
          <div className="row" style={{ gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Card</label>
              <input value={item.memo ?? ""} placeholder="American Express" onChange={(e) => updateItem(item.id, { memo: e.target.value })} />
            </div>
            <div className="field" style={{ width: 80 }}>
              <label>Due day</label>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOf(item.startDate)}
                onChange={(e) => updateItem(item.id, { startDate: withDay(item.startDate, Number(e.target.value)) })}
              />
            </div>
            <div className="field" style={{ width: 150 }}>
              <label>Monthly budget</label>
              <MoneyInput value={item.amount} step="0.01" onChange={(n) => updateItem(item.id, { amount: n })} />
            </div>
            <button className="btn sm ghost" onClick={() => removeItem(item.id)} title="Remove card">✕</button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Fill in the actual as each month closes — a blank month uses the budget ({fmtMoney(item.amount)}).
          </div>
          <div className="amex-grid">
            {months.map((ym) => {
              const ov = item.overrides?.[ym];
              return (
                <label className={`amex-month${ov != null ? " actual" : ""}`} key={ym} title={ov != null ? "Actual" : "Budget"}>
                  <span className="m">{fmtMonth(ym)}</span>
                  <div className="money-input">
                    <span className="prefix">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={ov ?? ""}
                      placeholder={String(Math.round(item.amount))}
                      onChange={(e) => setOverride(item, ym, e.target.value)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {amex.length === 0 && (
        <button className="btn sm ghost" onClick={addAmex} style={{ marginBottom: 16 }}>
          + Add AmEx card
        </button>
      )}

      {/* Operating expenses — simple recurring list */}
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>Recurring expenses</div>
        <div className="spacer" />
        {opex.length > 0 && (
          <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Edit"}</button>
        )}
      </div>

      {opex.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>No operating expenses yet — add your first below.</div>}

      {/* Read view */}
      {!editing &&
        opex.map((it) => (
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
        opex.map((it) => (
          <div
            key={it.id}
            style={{ display: "grid", gridTemplateColumns: "1.8fr 0.9fr 0.7fr 0.9fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}
          >
            <div className="field">
              <label>Expense</label>
              <input value={it.memo ?? ""} placeholder="e.g. BlueCrossBlueShield" onChange={(e) => updateItem(it.id, { memo: e.target.value })} />
            </div>
            <div className="field">
              <label>Frequency</label>
              <select value={it.frequency} onChange={(e) => updateItem(it.id, { frequency: e.target.value as RecurringFrequency })}>
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
                  onChange={(e) => updateItem(it.id, { startDate: withDay(it.startDate, Number(e.target.value)) })}
                />
              ) : (
                <input value="—" disabled />
              )}
            </div>
            <div className="field">
              <label>Amount</label>
              <MoneyInput value={it.amount} step="0.01" onChange={(n) => updateItem(it.id, { amount: n })} />
            </div>
            <button className="btn sm ghost" onClick={() => removeItem(it.id)} title="Remove">✕</button>
          </div>
        ))}

      {editing && (
        <button className="btn sm" onClick={addOpex} style={{ marginTop: 6 }}>
          + Add operating expense
        </button>
      )}
      {!editing && opex.length === 0 && (
        <button className="btn sm" onClick={() => { setEditing(true); addOpex(); }} style={{ marginTop: 6 }}>
          + Add operating expense
        </button>
      )}
    </div>
  );
}
