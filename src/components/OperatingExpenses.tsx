"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { CashEvent, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Operating Expenses — recurring costs, company cards (AmEx-style, with a
 * month-by-month actuals grid over a budget), and one-time direct-paid
 * expenses. Styled to the Claude Design mockup; a read/edit toggle keeps a
 * clean read once things are entered.
 *
 * Data model: recurring "operatingExpense" items, "amex"-category items as
 * company cards (with per-month `overrides`), and dated "operatingExpense"
 * events as one-time expenses. Anything in Bill.com or on the card statement
 * is tracked by those feeds — don't re-enter it here.
 */

const OPEX = "operatingExpense" as const;
const AMEX = "amex" as const;
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
  return { weekly: "Weekly", biweekly: "Biweekly", semimonthly: "Semi-monthly", monthly: "Monthly" }[item.frequency];
}
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CARD: CSSProperties = { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px" };

function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".13em", textTransform: "uppercase", color: color ?? "var(--text-dim)" }}>
      {children}
    </div>
  );
}
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-cond)", fontWeight: 700,
        fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", padding: "8px 14px", borderRadius: 8,
        border: "1.5px solid var(--text)", background: "transparent", color: "var(--text)", cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 0 }}>+</span> {label}
    </button>
  );
}

export function OperatingExpenses() {
  const { input, setInput } = useStore();
  const anchor = input.anchorDate;
  const anchorPrefix = anchor.slice(0, 7);
  const [editing, setEditing] = useState(false);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());

  const all = input.recurring ?? [];
  const opex = all.filter((r) => r.category === OPEX);
  const amex = all.filter((r) => r.category === AMEX);
  const oneoffsAll = (input.events ?? []).filter((e) => e.category === OPEX);
  // Sort by date for the read view only. While editing, keep insertion order so
  // a row doesn't jump to a new position (closing the native date picker) the
  // moment you change its date — that read as "can't edit the date".
  const oneoffs = editing ? oneoffsAll : [...oneoffsAll].sort((a, b) => a.date.localeCompare(b.date));

  const updateItem = (id: string | undefined, patch: Partial<RecurringItem>) =>
    setInput((prev) => ({ ...prev, recurring: (prev.recurring ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeItem = (id: string | undefined) =>
    setInput((prev) => ({ ...prev, recurring: (prev.recurring ?? []).filter((r) => r.id !== id) }));
  const addOpex = () =>
    setInput((prev) => ({
      ...prev,
      recurring: [...(prev.recurring ?? []), { id: `opex-${Date.now()}`, category: OPEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-01`, basis: "committed", memo: "" }],
    }));
  const addAmex = () =>
    setInput((prev) => ({
      ...prev,
      recurring: [...(prev.recurring ?? []), { id: `amex-${Date.now()}`, category: AMEX, amount: 0, frequency: "monthly", startDate: `${anchorPrefix}-06`, basis: "committed", memo: "New card" }],
    }));
  const updateEvent = (id: string | undefined, patch: Partial<CashEvent>) =>
    setInput((prev) => ({ ...prev, events: (prev.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeEvent = (id: string | undefined) =>
    setInput((prev) => ({ ...prev, events: (prev.events ?? []).filter((e) => e.id !== id) }));
  const addOneoff = () =>
    setInput((prev) => ({ ...prev, events: [...(prev.events ?? []), { id: `opex1-${Date.now()}`, category: OPEX, amount: 0, date: anchor, basis: "committed", memo: "" }] }));
  const setOverride = (item: RecurringItem, ym: string, raw: string) => {
    const ov = { ...(item.overrides ?? {}) };
    if (raw === "") delete ov[ym];
    else ov[ym] = Number(raw.replace(/[^0-9.]/g, ""));
    updateItem(item.id, { overrides: Object.keys(ov).length ? ov : undefined });
  };

  const months = monthsFrom(anchor, 12);
  const monthlyItems = opex.filter((r) => r.frequency === "monthly");
  const otherItems = opex.filter((r) => r.frequency !== "monthly");
  const monthlySum = monthlyItems.reduce((s, r) => s + r.amount, 0);
  const otherMo = otherItems.reduce((s, r) => s + monthlyEquivalent(r), 0);
  const cardsBudget = amex.reduce((s, c) => s + c.amount, 0);
  const recurringMo = monthlySum + otherMo;
  const total = recurringMo + cardsBudget;
  const oneoffTotal = oneoffs.reduce((s, e) => s + e.amount, 0);

  const chip = (label: string, val: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{val}</div>
    </div>
  );

  // ---- recurring group (Monthly / other) ----
  const grid = "minmax(0,1fr) 150px 128px" + (editing ? " 34px" : "");
  const recGroup = (title: string, rows: RecurringItem[], right: string) => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 4px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Eyebrow color="var(--text)">{title}</Eyebrow>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{rows.length} item{rows.length === 1 ? "" : "s"}</span>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{right}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 14, padding: "0 4px 8px", borderBottom: "1px solid var(--border)" }}>
        <Eyebrow>Expense</Eyebrow>
        <div style={{ textAlign: "right" }}><Eyebrow>Amount</Eyebrow></div>
        <div style={{ textAlign: "right" }}><Eyebrow>Per month</Eyebrow></div>
        {editing && <div />}
      </div>
      {rows.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 4px" }}>None.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: grid, alignItems: "center", gap: 14, padding: "12px 4px", borderBottom: "1px solid rgba(19,19,19,0.05)" }}>
          <div style={{ minWidth: 0 }}>
            {editing ? (
              <input value={r.memo ?? ""} placeholder="Expense name" onChange={(e) => updateItem(r.id, { memo: e.target.value })} style={rowNameInput} />
            ) : (
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{r.memo || "Unnamed expense"}</div>
            )}
            <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", marginTop: 2 }}>
              {cadence(r)}
              {!editing && r.endDate && <span style={{ color: "var(--text-faint)" }}> · Ends {fmtShortDate(r.endDate)}</span>}
            </div>
            {editing && (
              r.endDate ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Ends</span>
                  <input type="date" min={r.startDate} value={r.endDate} onChange={(e) => updateItem(r.id, { endDate: e.target.value || undefined })} style={{ ...boxInput, padding: "5px 8px", fontSize: 13 }} />
                  <button onClick={() => updateItem(r.id, { endDate: undefined })} title="Remove end date" style={xBtn}>✕</button>
                </div>
              ) : (
                <button onClick={() => updateItem(r.id, { endDate: `${monthsFrom(r.startDate, 13)[12]}-01` })} style={endDateBtn}>+ Set end date</button>
              )
            )}
          </div>
          {editing ? (
            <MoneyInput value={r.amount} step="0.01" onChange={(n) => updateItem(r.id, { amount: n })} />
          ) : (
            <div style={{ textAlign: "right", fontSize: 14.5, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{money2(r.amount)}</div>
          )}
          <div style={{ textAlign: "right", fontSize: 14, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{money2(monthlyEquivalent(r))}</div>
          {editing && (
            <button onClick={() => removeItem(r.id)} title="Remove" style={xBtn}>✕</button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero */}
      <div style={{ ...CARD, display: "flex", gap: 36, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <Eyebrow>Monthly run-rate</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
            <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 44, lineHeight: 0.9 }}>{money0(total)}</span>
            <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 18, color: "var(--text-dim)" }}>/mo</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {chip("Recurring", money0(recurringMo) + "/mo")}
        {chip("Cards", money0(cardsBudget) + "/mo")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <p style={{ fontSize: 14, color: "#4a4a4a", lineHeight: 1.5, margin: 0, maxWidth: 720 }}>
          Recurring operating costs only. Payroll lives on the Staff Roster, and anything paid through Bill.com — like
          rent — or on a card statement belongs to that feed, so nothing is double-counted.
        </p>
        <div style={{ flex: 1 }} />
        <button className={`btn sm ${editing ? "primary" : ""}`} onClick={() => setEditing((v) => !v)} style={{ flex: "0 0 auto" }}>
          {editing ? "Done editing" : "Edit amounts"}
        </button>
      </div>

      {/* Company cards */}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow color="var(--text)">Company cards</Eyebrow>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Budget flows to the forecast; enter actuals as months close</span>
          </div>
          <AddButton label="Add card" onClick={() => { setEditing(true); addAmex(); }} />
        </div>
        {amex.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>No cards yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {amex.map((c) => {
            const open = openCards.has(c.id ?? "");
            const nOv = Object.keys(c.overrides ?? {}).length;
            return (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 240px", minWidth: 180 }}>
                    <Eyebrow>Card</Eyebrow>
                    {editing ? (
                      <input value={c.memo ?? ""} placeholder="Card name" onChange={(e) => updateItem(c.id, { memo: e.target.value })} style={{ ...boxInput, width: "100%", marginTop: 5 }} />
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{c.memo || "Card"}</div>
                    )}
                  </div>
                  <div>
                    <Eyebrow>Due day</Eyebrow>
                    {editing ? (
                      <input type="number" min={1} max={31} value={dayOf(c.startDate)} onChange={(e) => updateItem(c.id, { startDate: withDay(c.startDate, Number(e.target.value)) })} style={{ ...boxInput, width: 64, marginTop: 5 }} />
                    ) : (
                      <div style={{ fontSize: 15, marginTop: 4 }}>{ordinal(dayOf(c.startDate))}</div>
                    )}
                  </div>
                  <div>
                    <Eyebrow>Monthly budget</Eyebrow>
                    {editing ? (
                      <div style={{ width: 140, marginTop: 5 }}><MoneyInput value={c.amount} step="0.01" onChange={(n) => updateItem(c.id, { amount: n })} /></div>
                    ) : (
                      <div style={{ fontSize: 15, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{money2(c.amount)}</div>
                    )}
                  </div>
                  {editing && <button onClick={() => removeItem(c.id)} title="Remove card" style={{ ...xBtn, width: 34, height: 34, border: "1px solid var(--border)", background: "#fff", borderRadius: 8 }}>✕</button>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                  <button onClick={() => toggleCard(c.id ?? "")} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "none", cursor: "pointer", padding: 0, color: "#4a4a4a", fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase" }}>
                    <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
                    {open ? "Hide monthly actuals" : "Monthly actuals"}
                  </button>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                    {nOv === 0 ? `Using budget ${money0(c.amount)} for all 12 months` : `${nOv} month${nOv === 1 ? "" : "s"} with actuals · rest use budget`}
                  </span>
                </div>
                {open && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginTop: 16 }}>
                    {months.map((ym) => {
                      const ov = c.overrides?.[ym];
                      return (
                        <label key={ym} style={{ display: "flex", flexDirection: "column", gap: 4 }} title={ov != null ? "Actual" : "Budget"}>
                          <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)" }}>{fmtMonth(ym)}</span>
                          <div className="money-input">
                            <span className="prefix">$</span>
                            <input type="number" step="0.01" value={ov ?? ""} placeholder={String(Math.round(c.amount))} onChange={(e) => setOverride(c, ym, e.target.value)} style={{ color: ov != null ? "var(--text)" : "var(--text-faint)" }} />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recurring expenses */}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <Eyebrow color="var(--text)">Recurring expenses</Eyebrow>
          <AddButton label="Add expense" onClick={() => { setEditing(true); addOpex(); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {recGroup("Monthly", monthlyItems, `${money2(monthlySum)} /mo`)}
          {recGroup("Weekly & other", otherItems, `${money0(otherMo)} /mo`)}
        </div>
      </div>

      {/* One-time expenses */}
      <div style={CARD}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow color="var(--text)">One-time expenses</Eyebrow>
            {oneoffs.length > 0 && <span style={{ fontSize: 13, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{money0(oneoffTotal)} total</span>}
          </div>
          <AddButton label="Add one-time" onClick={() => { setEditing(true); addOneoff(); }} />
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
          Ad-hoc costs paid directly (a conference, a one-off purchase) that aren&apos;t on a card or in Bill.com.
        </div>
        {oneoffs.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>None scheduled.</div>}
        {oneoffs.map((e) => (
          <div key={e.id} style={{ display: "grid", gridTemplateColumns: editing ? "minmax(0,1fr) 150px 128px 34px" : "minmax(0,1fr) 128px", alignItems: "center", gap: 14, padding: "12px 4px", borderBottom: "1px solid rgba(19,19,19,0.05)" }}>
            {editing ? (
              <input value={e.memo ?? ""} placeholder="e.g. SXSW conference" onChange={(ev) => updateEvent(e.id, { memo: ev.target.value })} style={rowNameInput} />
            ) : (
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{e.memo || "Unnamed"}</div>
                <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", marginTop: 2 }}>{fmtShortDate(e.date)}</div>
              </div>
            )}
            {editing && <input type="date" value={e.date} onChange={(ev) => updateEvent(e.id, { date: ev.target.value })} style={boxInput} />}
            {editing ? (
              <MoneyInput value={e.amount} step="0.01" onChange={(n) => updateEvent(e.id, { amount: n })} />
            ) : (
              <div style={{ textAlign: "right", fontSize: 14.5, fontVariantNumeric: "tabular-nums" }}>{money2(e.amount)}</div>
            )}
            {editing && <button onClick={() => removeEvent(e.id)} title="Remove" style={xBtn}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  );

  function toggleCard(id: string) {
    setOpenCards((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
}

const boxInput: CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, background: "#fff", padding: "8px 10px", fontFamily: "var(--font-body)", fontSize: 14 };
const rowNameInput: CSSProperties = { ...boxInput, width: "100%", maxWidth: 440, fontWeight: 700 };
const xBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 14, display: "grid", placeItems: "center" };
const endDateBtn: CSSProperties = { marginTop: 6, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 12, padding: 0, textAlign: "left" };
