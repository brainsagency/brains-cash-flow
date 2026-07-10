"use client";

import { useState, type CSSProperties } from "react";
import { isValidISODate, type ForecastInput, type StaffMember } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Staff roster — the authoritative payroll source. Each person carries an
 * annual salary, a hire date, an optional termination date, and optional
 * severance. When the roster has anyone in it, the store expands it into
 * payroll cash streams (semi-monthly, on the 1st & 15th) that replace the
 * manual "Payroll" line, and adds a one-off severance disbursement on each
 * termination date.
 */

function isActiveThisMonth(m: StaffMember, anchor: string): boolean {
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = `${anchor.slice(0, 7)}-31`;
  if (m.doh > monthEnd) return false;
  if (m.dot && m.dot < monthStart) return false;
  return true;
}
function effectiveSalary(m: StaffMember, anchor: string): number {
  if (m.salaryChangeDate && m.newSalary !== undefined && m.salaryChangeDate <= anchor) return m.newSalary;
  return m.annualSalary;
}
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const CARD: CSSProperties = { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 };
const eyebrow: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)" };
const editLink: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 };

export function StaffRoster() {
  const { input, setInput } = useStore();
  const staff = input.staff ?? [];
  const load = input.staffLoadFactor ?? 1;
  const anchor = input.anchorDate;
  const [editing, setEditing] = useState(false);

  const write = (next: StaffMember[]) => setInput((prev: ForecastInput) => ({ ...prev, staff: next }));
  const setLoad = (pct: number) => setInput((prev: ForecastInput) => ({ ...prev, staffLoadFactor: Math.max(1, 1 + (pct || 0) / 100) }));
  const update = (i: number, patch: Partial<StaffMember>) => write(staff.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => write(staff.filter((_, idx) => idx !== i));
  const add = () => write([...staff, { id: `staff-${Date.now()}`, name: "", annualSalary: 0, doh: anchor }]);

  const active = staff.filter((m) => isActiveThisMonth(m, anchor));
  const monthlyPayroll = (active.reduce((s, m) => s + effectiveSalary(m, anchor), 0) * load) / 12;
  const loadPct = Math.round((load - 1) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={CARD}>
        {/* Header: title + monthly total + Edit */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14 }}>
          <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 17, letterSpacing: ".02em" }}>Staff Roster</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 20, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {money0(monthlyPayroll)}<span style={{ color: "var(--text-faint)", fontWeight: 400 }}>/mo</span>
            </div>
            {staff.length > 0 && (
              <button style={editLink} onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Edit"}</button>
            )}
          </div>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, margin: 0, maxWidth: 1000 }}>
          The roster drives payroll (semi-monthly, 1st &amp; 15th) — while anyone is listed here it replaces the manual
          Payroll line. To model a departure as an <b style={{ color: "#4a4a4a" }}>actual</b>, set a Term date (and any
          severance / vacation payout): pay stops and those cash-outs land on that date. Hypothetical cuts belong in Scenarios.
        </p>

        {/* Employer load */}
        <div>
          <div style={{ ...eyebrow, marginBottom: 6 }}>Employer load (taxes, benefits, 401k)</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {editing ? (
                <input type="number" min={0} step={1} value={loadPct} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 80, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", padding: "6px 8px", fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 18 }} />
              ) : (
                <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 20, color: "var(--text)" }}>{loadPct}%</span>
              )}
              <span style={{ fontSize: 13.5, color: "var(--text-dim)" }}>on gross salary</span>
            </div>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{active.length} active · {staff.length} on roster</span>
          </div>
        </div>

        {staff.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
            No staff yet — add people below, or paste your roster and I&apos;ll bulk-load it.
          </div>
        )}

        {/* Read view */}
        {!editing && (
          <div>
            {staff.map((m) => {
              const gone = m.dot && isValidISODate(m.dot) && m.dot < `${anchor.slice(0, 7)}-01`;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, padding: "13px 4px", borderTop: "1px solid rgba(19,19,19,0.05)", opacity: gone ? 0.5 : 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{m.name || "Unnamed"}</span>
                    {isValidISODate(m.doh) && <span style={{ fontSize: 13, color: "var(--text-dim)" }}>since {fmtShortDate(m.doh)}</span>}
                    {m.dot && isValidISODate(m.dot) && <span style={{ fontSize: 13, color: "var(--red)" }}>· ends {fmtShortDate(m.dot)}</span>}
                    {m.severance ? <span style={{ fontSize: 13, color: "var(--text-dim)" }}>· sev {fmtMoney(m.severance)}</span> : null}
                    {m.vacationPayout ? <span style={{ fontSize: 13, color: "var(--text-dim)" }}>· vac {fmtMoney(m.vacationPayout)}</span> : null}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 500, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {fmtMoney(m.annualSalary, { cents: true })}<span style={{ color: "var(--text-faint)", fontWeight: 400 }}> /yr</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Edit view */}
        {editing && (
          <div className="table-scroll">
            {staff.length > 0 && (
              <div className="staff-edit-row" style={{ marginBottom: 6, fontSize: 12, color: "var(--text-dim)" }}>
                <span>Name</span>
                <span>Annual salary</span>
                <span>Hire date</span>
                <span>Term date</span>
                <span>Severance</span>
                <span>Vacation payout</span>
                <span />
              </div>
            )}
            {staff.map((m, i) => {
              const gone = m.dot && isValidISODate(m.dot) && m.dot < `${anchor.slice(0, 7)}-01`;
              return (
                <div key={m.id} className="staff-edit-row" style={{ alignItems: "center", marginBottom: 8, opacity: gone ? 0.55 : 1 }}>
                  <input value={m.name} placeholder="Full name" onChange={(e) => update(i, { name: e.target.value })} />
                  <MoneyInput value={m.annualSalary} step="0.01" onChange={(n) => update(i, { annualSalary: n })} />
                  <input type="date" value={m.doh} onChange={(e) => update(i, { doh: e.target.value })} />
                  <input type="date" value={m.dot ?? ""} onChange={(e) => update(i, { dot: e.target.value || undefined })} />
                  <MoneyInput value={m.severance ?? 0} step="0.01" onChange={(n) => update(i, { severance: n || undefined })} />
                  <MoneyInput value={m.vacationPayout ?? 0} step="0.01" onChange={(n) => update(i, { vacationPayout: n || undefined })} />
                  <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">✕</button>
                </div>
              );
            })}
          </div>
        )}

        {editing && <button className="btn sm" onClick={add} style={{ marginTop: 6, alignSelf: "flex-start" }}>+ Add staff member</button>}
        {!editing && staff.length === 0 && (
          <button className="btn sm" onClick={() => { setEditing(true); add(); }} style={{ marginTop: 6, alignSelf: "flex-start" }}>+ Add staff member</button>
        )}
      </div>
    </div>
  );
}
