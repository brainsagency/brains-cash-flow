"use client";

import { useEffect, useState } from "react";
import { isValidISODate, type ForecastInput, type StaffMember } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Staff roster — the authoritative payroll source. Each person carries an
 * annual salary, a hire date, an optional termination date, optional severance,
 * an optional scheduled raise, and a cost center. When the roster has anyone in
 * it, the store expands it into payroll cash streams (semi-monthly, on the 1st
 * & 15th) that replace the manual "Payroll" line, and adds a one-off severance
 * disbursement on each termination date.
 *
 * Laid out as a split card: the roster reads as one line per person, and the
 * detail panel edits whoever is selected. A person carries ten fields — too
 * many for a row, which is why the raise and cost center had no home before.
 */

function isActiveThisMonth(m: StaffMember, anchor: string): boolean {
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = `${anchor.slice(0, 7)}-31`;
  if (m.doh > monthEnd) return false;
  if (m.dot && m.dot < monthStart) return false;
  return true;
}
/** Former = term date already passed (before this month). A future-dated
 *  term is still an active, still-paid employee, so it does NOT count here. */
function isFormer(m: StaffMember, anchor: string): boolean {
  return !!(m.dot && isValidISODate(m.dot) && m.dot < `${anchor.slice(0, 7)}-01`);
}
function effectiveSalary(m: StaffMember, anchor: string): number {
  if (m.salaryChangeDate && m.newSalary !== undefined && m.salaryChangeDate <= anchor) return m.newSalary;
  return m.annualSalary;
}
/** A raise that hasn't taken effect yet — worth showing on the line. */
function pendingRaise(m: StaffMember, anchor: string): { date: string; amount: number } | null {
  if (!m.salaryChangeDate || m.newSalary === undefined) return null;
  if (!isValidISODate(m.salaryChangeDate) || m.salaryChangeDate <= anchor) return null;
  return { date: m.salaryChangeDate, amount: m.newSalary };
}
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function StaffRoster() {
  const { input, setInput } = useStore();
  const staff = input.staff ?? [];
  const load = input.staffLoadFactor ?? 1;
  const anchor = input.anchorDate;
  const [editing, setEditing] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [showFormer, setShowFormer] = useState(false);

  const write = (next: StaffMember[]) => setInput((prev: ForecastInput) => ({ ...prev, staff: next }));
  const paidThrough = input.payrollPaidThrough;
  const setPaidThrough = (v: string) => setInput((prev: ForecastInput) => ({ ...prev, payrollPaidThrough: v || undefined }));
  const setLoad = (pct: number) => setInput((prev: ForecastInput) => ({ ...prev, staffLoadFactor: Math.max(1, 1 + (pct || 0) / 100) }));
  const update = (id: string, patch: Partial<StaffMember>) =>
    write(staff.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => {
    write(staff.filter((m) => m.id !== id));
    setSelId(staff.find((m) => m.id !== id)?.id ?? null);
  };
  const add = () => {
    const id = `staff-${Date.now()}`;
    write([...staff, { id, name: "", annualSalary: 0, doh: anchor }]);
    setEditing(true);
    setSelId(id);
  };
  /** Clicking a person in the read view opens the editor on them. */
  const openOn = (id: string) => {
    setSelId(id);
    setEditing(true);
  };

  const active = staff.filter((m) => isActiveThisMonth(m, anchor));
  const grossMonthly = active.reduce((s, m) => s + effectiveSalary(m, anchor), 0) / 12;
  const loadMonthly = grossMonthly * (load - 1);
  const loadPct = Math.round((load - 1) * 100);
  const current = staff.filter((m) => !isFormer(m, anchor));
  const former = staff.filter((m) => isFormer(m, anchor));

  const selected = staff.find((m) => m.id === selId) ?? null;
  useEffect(() => {
    if (!editing) return;
    if (!staff.some((m) => m.id === selId)) setSelId(staff[0]?.id ?? null);
  }, [editing, staff, selId]);

  const person = (m: StaffMember) => {
    const raise = pendingRaise(m, anchor);
    const ending = !!(m.dot && isValidISODate(m.dot));
    const hue = ending ? "var(--red)" : "var(--green)";
    return (
      <button
        key={m.id}
        className={`split-line${editing && m.id === selId ? " selected" : ""}`}
        onClick={() => openOn(m.id)}
        title={editing ? "Edit this person" : "Open the editor on this person"}
      >
        <span className="split-spine" style={{ background: hue }} />
        <span className="split-line-body">
          <span className="split-line-desc">
            {m.name || <span className="muted">Unnamed</span>}
            {m.costCenter && <span className="staff-cc">{m.costCenter}</span>}
          </span>
          <span className="split-line-meta">{describe(m, anchor)}</span>
        </span>
        <span className="split-line-amt mono">
          {fmtMoney(effectiveSalary(m, anchor))}
          <span className="split-line-unit">/yr</span>
          {raise && (
            <span className="staff-raise" title={`Rises to ${fmtMoney(raise.amount)} on ${fmtShortDate(raise.date)}`}>
              → {fmtMoney(raise.amount)}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className={`card split-card${editing ? " editing" : ""}`}>
      <div className="split-main">
        <div className="split-head">
          <div>
            <h2 className="split-title">Staff Roster</h2>
            <div className="split-sub">
              {active.length} active · {staff.length} on roster · drives payroll on the 1st &amp; 15th
            </div>
          </div>
          <div className="split-stat">
            <span className="split-eyebrow">Payroll / month</span>
            <span className="split-stat-val mono">{money0(grossMonthly + loadMonthly)}</span>
          </div>
        </div>

        <div className="split-totals">
          <div className="split-total">
            <span className="split-eyebrow">Gross salaries</span>
            <span className="mono">{money0(grossMonthly)}</span>
          </div>
          <div className="split-total">
            <span className="split-eyebrow">Employer load · {loadPct}%</span>
            <span className="mono">{money0(loadMonthly)}</span>
          </div>
        </div>

        <div className="staff-settings">
          <label className="staff-setting">
            <span className="split-eyebrow">Payroll paid through</span>
            <span className="staff-setting-ctl">
              <input type="date" value={paidThrough ?? ""} onChange={(e) => setPaidThrough(e.target.value)} />
              {paidThrough && (
                <button className="btn sm ghost" onClick={() => setPaidThrough("")}>Clear</button>
              )}
            </span>
          </label>
          <label className="staff-setting">
            <span className="split-eyebrow">Employer load %</span>
            <span className="staff-setting-ctl">
              <input type="number" min={0} step={1} value={loadPct} onChange={(e) => setLoad(Number(e.target.value))} style={{ width: 78 }} />
              <span className="muted">taxes, benefits, 401k</span>
            </span>
          </label>
        </div>
        <p className="split-hint staff-note">
          Runs on or before the paid-through date are treated as already paid and dropped from the forecast — payroll often
          debits a day or two early, so set it to the pay date of the last run that cleared. To model a departure as an
          actual, give the person a term date; hypothetical cuts belong in Scenarios.
        </p>

        <div className="split-list">
          {staff.length === 0 && (
            <div className="split-empty muted">No staff yet — add people below, or paste your roster and I&apos;ll bulk-load it.</div>
          )}
          {current.map(person)}
          {former.length > 0 && (
            <>
              <button className="staff-former" onClick={() => setShowFormer((v) => !v)}>
                <span>{showFormer ? "▾" : "▸"}</span> Former · {former.length}
              </button>
              {showFormer && former.map(person)}
            </>
          )}
        </div>

        <div className="split-foot">
          {editing ? (
            <>
              <div className="split-add">
                <button className="btn sm" onClick={add}>+ Add staff member</button>
              </div>
              <button className="btn sm primary" onClick={() => setEditing(false)}>Done</button>
            </>
          ) : (
            <>
              <div className="split-add" />
              {staff.length === 0 ? (
                <button className="btn sm" onClick={add}>+ Add staff member</button>
              ) : (
                <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && selected && (
        <div className="split-editor">
          <span className="split-eyebrow">Editing</span>

          <label className="split-field">
            Full name
            <input
              value={selected.name}
              placeholder="Full name"
              onChange={(e) => update(selected.id, { name: e.target.value })}
            />
          </label>

          <div className="split-pair">
            <label className="split-field">
              Annual salary
              <MoneyInput value={selected.annualSalary} step="0.01" onChange={(n) => update(selected.id, { annualSalary: n })} />
            </label>
            <label className="split-field">
              Cost center
              <input
                value={selected.costCenter ?? ""}
                placeholder="e.g. Creative"
                onChange={(e) => update(selected.id, { costCenter: e.target.value || undefined })}
              />
            </label>
          </div>

          <label className="split-field">
            Hire date
            <input type="date" value={selected.doh} onChange={(e) => update(selected.id, { doh: e.target.value })} />
          </label>

          <div className="split-group">
            <span className="split-eyebrow">Scheduled raise</span>
            <div className="split-pair">
              <label className="split-field">
                Effective
                <input
                  type="date"
                  value={selected.salaryChangeDate ?? ""}
                  onChange={(e) => update(selected.id, { salaryChangeDate: e.target.value || undefined })}
                />
              </label>
              <label className="split-field">
                New salary
                <MoneyInput
                  value={selected.newSalary ?? 0}
                  step="0.01"
                  onChange={(n) => update(selected.id, { newSalary: n || undefined })}
                />
              </label>
            </div>
          </div>

          <div className="split-group">
            <span className="split-eyebrow">Departure</span>
            <label className="split-field">
              Term date
              <input
                type="date"
                value={selected.dot ?? ""}
                onChange={(e) => update(selected.id, { dot: e.target.value || undefined })}
              />
            </label>
            <div className="split-pair">
              <label className="split-field">
                Severance
                <MoneyInput
                  value={selected.severance ?? 0}
                  step="0.01"
                  onChange={(n) => update(selected.id, { severance: n || undefined })}
                />
              </label>
              <label className="split-field">
                Paid as
                <select
                  value={selected.severancePayout ?? "lump"}
                  onChange={(e) => update(selected.id, { severancePayout: e.target.value === "payroll" ? "payroll" : undefined })}
                >
                  <option value="lump">Lump sum</option>
                  <option value="payroll">On payroll</option>
                </select>
              </label>
            </div>
            <label className="split-field">
              Vacation / PTO payout
              <MoneyInput
                value={selected.vacationPayout ?? 0}
                step="0.01"
                onChange={(n) => update(selected.id, { vacationPayout: n || undefined })}
              />
            </label>
          </div>

          <p className="split-hint">{hintFor(selected, anchor, load)}</p>

          <button className="btn sm split-remove" onClick={() => remove(selected.id)}>
            Remove person
          </button>
        </div>
      )}
    </div>
  );
}

/** The person's tenure as a sentence: since when, until when, what's owed. */
function describe(m: StaffMember, anchor: string): string {
  const parts: string[] = [];
  if (isValidISODate(m.doh)) parts.push(`Since ${fmtShortDate(m.doh)}`);
  const raise = pendingRaise(m, anchor);
  if (raise) parts.push(`raise ${fmtShortDate(raise.date)}`);
  if (m.dot && isValidISODate(m.dot)) {
    parts.push(`${isFormer(m, anchor) ? "left" : "ends"} ${fmtShortDate(m.dot)}`);
  }
  if (m.severance) parts.push(`sev ${fmtMoney(m.severance)}${m.severancePayout === "payroll" ? " on payroll" : ""}`);
  if (m.vacationPayout) parts.push(`vac ${fmtMoney(m.vacationPayout)}`);
  return parts.length ? parts.join(" · ") : "No hire date set";
}

/** What the selected person costs the forecast, in plain language. */
function hintFor(m: StaffMember, anchor: string, load: number): string {
  const monthly = (effectiveSalary(m, anchor) * load) / 12;
  if (isFormer(m, anchor)) return "Already departed — no further payroll, but any severance still lands on the term date.";
  const base = `Costs ${money0(monthly)} a month loaded, paid across the 1st and 15th.`;
  if (m.dot && isValidISODate(m.dot)) return `${base} Pay stops on ${fmtShortDate(m.dot)}.`;
  return base;
}
