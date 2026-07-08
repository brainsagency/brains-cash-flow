"use client";

import type { ForecastInput, StaffMember } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";

/**
 * Staff roster — the authoritative payroll source. Each person carries an
 * annual salary, a hire date, an optional termination date, and optional
 * severance. When the roster has anyone in it, the store expands it into
 * payroll cash streams that replace the manual "Payroll" line, and adds a
 * one-off severance disbursement on each termination date.
 *
 * This is how layoffs get modeled as *actuals*: set a person's termination
 * date (and severance) and their pay stops — and the cash-out shows — right
 * there in the base forecast. Hypothetical, not-yet-decided cuts still belong
 * in Scenarios.
 */

function isActiveThisMonth(m: StaffMember, anchor: string): boolean {
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = `${anchor.slice(0, 7)}-31`;
  if (m.doh > monthEnd) return false; // not hired yet
  if (m.dot && m.dot < monthStart) return false; // already gone
  return true;
}

/** Salary in effect as of the anchor (honors a scheduled raise). */
function effectiveSalary(m: StaffMember, anchor: string): number {
  if (m.salaryChangeDate && m.newSalary !== undefined && m.salaryChangeDate <= anchor) return m.newSalary;
  return m.annualSalary;
}

export function StaffRoster() {
  const { input, setInput } = useStore();
  const staff = input.staff ?? [];
  const load = input.staffLoadFactor ?? 1;
  const anchor = input.anchorDate;

  const write = (next: StaffMember[]) => setInput((prev: ForecastInput) => ({ ...prev, staff: next }));
  const setLoad = (pct: number) =>
    setInput((prev: ForecastInput) => ({ ...prev, staffLoadFactor: Math.max(1, 1 + (pct || 0) / 100) }));
  const update = (i: number, patch: Partial<StaffMember>) =>
    write(staff.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => write(staff.filter((_, idx) => idx !== i));
  const add = () =>
    write([
      ...staff,
      { id: `staff-${Date.now()}`, name: "", annualSalary: 0, doh: anchor },
    ]);

  const active = staff.filter((m) => isActiveThisMonth(m, anchor));
  const monthlyPayroll = (active.reduce((s, m) => s + effectiveSalary(m, anchor), 0) * load) / 12;
  const loadPct = Math.round((load - 1) * 100);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Staff Roster</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(monthlyPayroll)}/mo</span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        The roster drives payroll — while anyone is listed here it replaces the manual Payroll line. To model a
        departure as an <b>actual</b>, set a Term date (and severance): pay stops and the severance cash-out lands on
        that date. Hypothetical cuts belong in Scenarios.
      </div>

      <div className="row" style={{ marginBottom: 14, gap: 8, alignItems: "end" }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Employer load (taxes, benefits, 401k)</label>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              type="number"
              min={0}
              step={1}
              value={loadPct}
              onChange={(e) => setLoad(Number(e.target.value))}
              style={{ maxWidth: 90 }}
            />
            <span className="muted">% on gross salary</span>
          </div>
        </div>
        <div className="spacer" />
        <span className="muted">
          {active.length} active · {staff.length} on roster
        </span>
      </div>

      {staff.length === 0 && (
        <div className="muted" style={{ marginBottom: 12 }}>
          No staff yet — add people below, or paste your roster and I&apos;ll bulk-load it. Until then the sample
          Payroll line stands.
        </div>
      )}

      {staff.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr auto",
            gap: 8,
            marginBottom: 6,
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          <span>Name</span>
          <span>Annual salary</span>
          <span>Hire date</span>
          <span>Term date</span>
          <span>Severance</span>
          <span />
        </div>
      )}

      {staff.map((m, i) => {
        const gone = m.dot && m.dot < `${anchor.slice(0, 7)}-01`;
        return (
          <div
            key={m.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr auto",
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
              opacity: gone ? 0.55 : 1,
            }}
          >
            <input value={m.name} placeholder="Full name" onChange={(e) => update(i, { name: e.target.value })} />
            <input
              type="number"
              step="0.01"
              value={m.annualSalary}
              onChange={(e) => update(i, { annualSalary: Number(e.target.value) })}
            />
            <input type="date" value={m.doh} onChange={(e) => update(i, { doh: e.target.value })} />
            <input
              type="date"
              value={m.dot ?? ""}
              onChange={(e) => update(i, { dot: e.target.value || undefined })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="—"
              value={m.severance ?? ""}
              onChange={(e) => update(i, { severance: e.target.value ? Number(e.target.value) : undefined })}
            />
            <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">
              ✕
            </button>
          </div>
        );
      })}

      <button className="btn sm" onClick={add} style={{ marginTop: 6 }}>
        + Add staff member
      </button>
    </div>
  );
}
