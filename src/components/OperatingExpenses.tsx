"use client";

import { useState } from "react";
import type { CashEvent, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Editor for operating costs.
 *
 * AmEx (category "amex") is the headline variable expense, so it gets its own
 * section with a month-by-month grid: budget a monthly placeholder, then fill
 * in the actual as each month closes (a blank month uses the budget). Plain
 * recurring operating expenses (category "operatingExpense") are a list below,
 * and one-time expenses (a conference, a one-off purchase paid directly) are
 * dated operatingExpense events.
 *
 * Bills paid through Bill.com, or anything that lands on the AmEx statement,
 * belong to those feeds — don't re-enter here or it double-counts.
 */

const OPEX = "operatingExpense" as const;
const AMEX = "amex" as const;

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
  // One-time expenses are dated operatingExpense events.
  const oneoffs = (input.events ?? [])
    .filter((e) => e.category === OPEX)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Recurring writes rebuild the recurring array, preserving non-managed items.
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

  // One-time (event) writes, preserving all other events.
  const updateEvent = (id: string | undefined, patch: Partial<CashEvent>) =>
    setInput((prev) => ({
      ...prev,
      events: (prev.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  const removeEvent = (id: string | undefined) =>
    setInput((prev) => ({ ...prev, events: (prev.events ?? []).filter((e) => e.id !== id) }));
  const addOneoff = () =>
    setInput((prev) => ({
      ...prev,
      events: [
        ...(prev.events ?? []),
        { id: `opex1-${Date.now()}`, category: OPEX, amount: 0, date: anchor, basis: "committed", memo: "" },
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
  const oneoffTotal = oneoffs.reduce((s, e) => s + e.amount, 0);
  const canEdit = opex.length > 0 || oneoffs.length > 0;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Operating Expenses</h2>
        <div className="spacer" />
        <span className="pill-total mono" style={{ marginRight: canEdit ? 10 : 0 }}>{fmtMoney(monthlyTotal)}/mo</span>
        {canEdit && (
          <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Edit"}</button>
        )}
      </div>
      <div className="muted" style={{ marginBottom: 16 }}>
        Recurring costs and one-time expenses (payroll is on the Staff Roster). Anything on the AmEx statement or in
        Bill.com is tracked by those feeds — don&apos;t re-enter it here, or it double-counts.
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

      {/* Recurring operating expenses */}
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Recurring expenses</div>

      {opex.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>No recurring operating expenses yet.</div>}

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
        <button className="btn sm" onClick={addOpex} style={{ marginTop: 6 }}>+ Add recurring expense</button>
      )}
      {!editing && opex.length === 0 && (
        <button className="btn sm" onClick={() => { setEditing(true); addOpex(); }} style={{ marginTop: 6 }}>+ Add recurring expense</button>
      )}

      {/* One-time expenses */}
      <div className="row" style={{ marginTop: 22, marginBottom: 8 }}>
        <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>One-time expenses</div>
        <div className="spacer" />
        {oneoffs.length > 0 && <span className="mono muted" style={{ fontSize: 12 }}>{fmtMoney(oneoffTotal)} total</span>}
      </div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
        Ad-hoc costs paid directly (a conference, a one-off purchase) that aren&apos;t on AmEx or in Bill.com.
      </div>

      {oneoffs.length === 0 && !editing && <div className="muted" style={{ marginBottom: 12 }}>None scheduled.</div>}

      {!editing &&
        oneoffs.map((e) => (
          <div className="spec-row" key={e.id}>
            <span className="label">
              {e.memo || <span className="muted">Unnamed</span>}
              <span className="meta">{fmtShortDate(e.date)}</span>
            </span>
            <span className="val mono">{fmtMoney(e.amount, { cents: true })}</span>
          </div>
        ))}

      {editing &&
        oneoffs.map((e) => (
          <div
            key={e.id}
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}
          >
            <div className="field">
              <label>Expense</label>
              <input value={e.memo ?? ""} placeholder="e.g. SXSW conference" onChange={(ev) => updateEvent(e.id, { memo: ev.target.value })} />
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={e.date} onChange={(ev) => updateEvent(e.id, { date: ev.target.value })} />
            </div>
            <div className="field">
              <label>Amount</label>
              <MoneyInput value={e.amount} step="0.01" onChange={(n) => updateEvent(e.id, { amount: n })} />
            </div>
            <button className="btn sm ghost" onClick={() => removeEvent(e.id)} title="Remove">✕</button>
          </div>
        ))}

      {editing && (
        <button className="btn sm" onClick={addOneoff} style={{ marginTop: 6 }}>+ Add one-time expense</button>
      )}
      {!editing && oneoffs.length === 0 && (
        <button className="btn sm" onClick={() => { setEditing(true); addOneoff(); }} style={{ marginTop: 6 }}>+ Add one-time expense</button>
      )}
    </div>
  );
}
