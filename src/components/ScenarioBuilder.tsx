"use client";

import { useState } from "react";
import { addMonths, addRevenueTotal, type Billing, type Lever, type Scenario, type StaffMember } from "@engine/index.js";
import { fmtMoney } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

/**
 * Create / edit a scenario as a stack of levers. Headline levers:
 *  - Layoff group: pick real roster people; pay stops on the date and severance
 *    = N months of their pay (auto).
 *  - Add revenue: a one-off lump, a recurring monthly amount, or an
 *    installment schedule (how project work actually bills).
 *  - Hire: add a role's comp from a start date.
 * Combine any number of levers in one scenario.
 */

interface Props {
  initial: Scenario | null;
  staff: StaffMember[];
  anchor: string;
  onSave: (s: Scenario) => void;
  onClose: () => void;
  onDelete?: () => void;
}

type LeverKind = Lever["kind"];

function defaultLever(kind: LeverKind, anchor: string): Lever {
  const firstOfNextMonth = `${anchor.slice(0, 7)}-01`;
  switch (kind) {
    case "layoffGroup":
      return { kind, staffIds: [], effectiveDate: firstOfNextMonth, severanceWeeks: 4 };
    case "addRevenue":
      return { kind, mode: "recurring", amount: 25_000, startDate: firstOfNextMonth, label: "" };
    case "hire":
      return { kind, role: "", annualComp: 150_000, startDate: firstOfNextMonth };
    default:
      return { kind: "addRevenue", mode: "oneoff", amount: 0, date: firstOfNextMonth };
  }
}

export function ScenarioBuilder({ initial, staff, anchor, onSave, onClose, onDelete }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [levers, setLevers] = useState<Lever[]>(initial?.levers ?? []);

  const setLever = (i: number, patch: Partial<Lever>) =>
    setLevers((prev) => prev.map((l, idx) => (idx === i ? ({ ...l, ...patch } as Lever) : l)));
  const removeLever = (i: number) => setLevers((prev) => prev.filter((_, idx) => idx !== i));
  const addLever = (kind: LeverKind) => setLevers((prev) => [...prev, defaultLever(kind, anchor)]);

  const save = () => {
    const id = initial?.id ?? `scn-${Date.now()}`;
    onSave({ id, name: name.trim() || "Untitled scenario", levers });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit scenario" : "New scenario"}</h3>
        <div className="muted" style={{ marginBottom: 14 }}>Stack levers to model a what-if. Combine as many as you like.</div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Scenario name</label>
          <input value={name} placeholder="e.g. RIF + new retainer" onChange={(e) => setName(e.target.value)} />
        </div>

        {levers.length === 0 && (
          <div className="muted" style={{ marginBottom: 12 }}>No levers yet — add one below.</div>
        )}

        {levers.map((l, i) => (
          <div className="lever-card" key={i}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 650 }}>{leverTitle(l.kind)}</span>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={() => removeLever(i)} title="Remove lever">✕</button>
            </div>
            <LeverEditor lever={l} staff={staff} onChange={(patch) => setLever(i, patch)} />
          </div>
        ))}

        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4, marginBottom: 20 }}>
          <span className="muted" style={{ marginRight: 4 }}>Add lever:</span>
          <button className="btn sm" onClick={() => addLever("layoffGroup")}>– Layoff group</button>
          <button className="btn sm" onClick={() => addLever("addRevenue")}>+ Add revenue</button>
          <button className="btn sm" onClick={() => addLever("hire")}>+ Hire</button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={save}>{initial ? "Save changes" : "Create scenario"}</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          {initial && onDelete && (
            <button className="btn sm ghost" style={{ color: "var(--red)" }} onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

function leverTitle(kind: LeverKind): string {
  switch (kind) {
    case "layoffGroup": return "Layoff group";
    case "addRevenue": return "Add revenue";
    case "hire": return "Hire";
    case "layoff": return "Layoff (single role)";
    case "churn": return "Client churn";
    case "pipelineSensitivity": return "Pipeline sensitivity";
    case "collectionTiming": return "Collection timing";
  }
}

function LeverEditor({ lever, staff, onChange }: { lever: Lever; staff: StaffMember[]; onChange: (patch: Partial<Lever>) => void }) {
  if (lever.kind === "layoffGroup") {
    const selected = new Set(lever.staffIds);
    const byStaff = lever.severanceByStaff ?? {};
    const defaultWeeks = lever.severanceWeeks ?? 0;
    const weeksFor = (id: string) => byStaff[id] ?? defaultWeeks;
    const vacByStaff = lever.vacationDaysByStaff ?? {};
    const defaultVacDays = lever.vacationDays ?? 0;
    const vacDaysFor = (id: string) => vacByStaff[id] ?? defaultVacDays;
    // Severance and vacation payout are gross pay (no employer load).
    const weeklyPay = (m: StaffMember) => m.annualSalary / 52;
    const dailyPay = (m: StaffMember) => m.annualSalary / 260; // working-day rate = weekly ÷ 5

    const toggle = (id: string) => {
      const next = new Set(selected);
      const nextBy = { ...byStaff };
      const nextVac = { ...vacByStaff };
      if (next.has(id)) { next.delete(id); delete nextBy[id]; delete nextVac[id]; }
      else next.add(id);
      onChange({ staffIds: [...next], severanceByStaff: nextBy, vacationDaysByStaff: nextVac } as Partial<Lever>);
    };
    const setPersonWeeks = (id: string, weeks: number) =>
      onChange({ severanceByStaff: { ...byStaff, [id]: weeks } } as Partial<Lever>);
    const setPersonVacDays = (id: string, days: number) =>
      onChange({ vacationDaysByStaff: { ...vacByStaff, [id]: days } } as Partial<Lever>);

    const selStaff = staff.filter((m) => selected.has(m.id));
    const selAnnual = selStaff.reduce((s, m) => s + m.annualSalary, 0);
    const totalSeverance = selStaff.reduce((s, m) => s + weeklyPay(m) * weeksFor(m.id), 0);
    const totalVacation = selStaff.reduce((s, m) => s + dailyPay(m) * vacDaysFor(m.id), 0);

    return (
      <>
        <div className="row" style={{ gap: 12, marginBottom: 10 }}>
          <div className="field" style={{ maxWidth: 180 }}>
            <label>Effective date</label>
            <input type="date" value={lever.effectiveDate} onChange={(e) => onChange({ effectiveDate: e.target.value } as Partial<Lever>)} />
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Default severance (weeks)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={defaultWeeks}
              onChange={(e) => onChange({ severanceWeeks: Number(e.target.value) } as Partial<Lever>)}
            />
          </div>
          <div className="field" style={{ maxWidth: 180 }}>
            <label>Severance payout</label>
            <select
              value={lever.severancePayout ?? "lump"}
              onChange={(e) => onChange({ severancePayout: e.target.value } as Partial<Lever>)}
            >
              <option value="lump">Lump sum</option>
              <option value="payroll">On payroll schedule</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Default vacation (days)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={defaultVacDays}
              onChange={(e) => onChange({ vacationDays: Number(e.target.value) } as Partial<Lever>)}
            />
          </div>
        </div>
        <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
          Pick who&apos;s affected — {selected.size} selected · {fmtMoney(selAnnual)}/yr
          {selected.size > 0 && totalSeverance > 0 && <> · severance {fmtMoney(totalSeverance)}</>}
          {selected.size > 0 && totalVacation > 0 && <> · vacation {fmtMoney(totalVacation)}</>}
        </div>
        <div className="staff-pick">
          {staff.length === 0 && <div className="muted" style={{ padding: 6 }}>No roster yet — add staff first.</div>}
          {staff.map((m) => {
            const on = selected.has(m.id);
            return (
              <div className="prow" key={m.id}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                  <span>{m.name || "Unnamed"}</span>
                </label>
                {on ? (
                  <span className="sal" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={weeksFor(m.id)}
                      onChange={(e) => setPersonWeeks(m.id, Number(e.target.value))}
                      style={{ width: 56, padding: "3px 5px" }}
                      title="Severance weeks for this person"
                    />
                    <span style={{ fontSize: 12 }}>wk</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={vacDaysFor(m.id)}
                      onChange={(e) => setPersonVacDays(m.id, Number(e.target.value))}
                      style={{ width: 56, padding: "3px 5px" }}
                      title="Vacation payout days for this person"
                    />
                    <span style={{ fontSize: 12 }}>d ≈ {fmtMoney(weeklyPay(m) * weeksFor(m.id) + dailyPay(m) * vacDaysFor(m.id))}</span>
                  </span>
                ) : (
                  <span className="sal">{fmtMoney(m.annualSalary)}</span>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  if (lever.kind === "addRevenue") {
    const billings = lever.billings ?? [];
    const setBillings = (next: Billing[]) => onChange({ billings: next } as Partial<Lever>);
    // Switching into schedule mode seeds the first installment from whatever
    // was already typed, so the amount and date aren't silently thrown away.
    const setMode = (mode: string) =>
      onChange(
        mode === "schedule" && billings.length === 0
          ? ({
              mode,
              billings: [{ date: lever.date ?? lever.startDate ?? "", amount: lever.amount || 0 }],
            } as Partial<Lever>)
          : ({ mode } as Partial<Lever>),
      );
    // A new row lands a month after the last one, same amount — so a four-part
    // schedule is three clicks, then edit whichever installments differ.
    const addBilling = () => {
      const last = billings[billings.length - 1];
      setBillings([
        ...billings,
        last?.date
          ? { date: addMonths(last.date, 1), amount: last.amount }
          : { date: lever.startDate ?? lever.date ?? "", amount: 0 },
      ]);
    };

    return (
      <>
        <div className="row" style={{ gap: 12, marginBottom: 10 }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Type</label>
            <select value={lever.mode} onChange={(e) => setMode(e.target.value)}>
              <option value="recurring">Recurring / mo</option>
              <option value="oneoff">One-off lump</option>
              <option value="schedule">Billing schedule</option>
            </select>
          </div>
          {lever.mode === "schedule" ? (
            <div className="field" style={{ maxWidth: 170 }}>
              <label>Booking value</label>
              <div className="lever-total mono">{fmtMoney(addRevenueTotal(lever))}</div>
            </div>
          ) : (
            <div className="field" style={{ maxWidth: 160 }}>
              <label>{lever.mode === "recurring" ? "Amount / month" : "Amount"}</label>
              <MoneyInput value={lever.amount} step="1000" onChange={(n) => onChange({ amount: n } as Partial<Lever>)} />
            </div>
          )}
          <div className="field" style={{ flex: 1 }}>
            <label>Label</label>
            <input value={lever.label ?? ""} placeholder="e.g. New retainer" onChange={(e) => onChange({ label: e.target.value } as Partial<Lever>)} />
          </div>
        </div>

        {lever.mode === "oneoff" && (
          <div className="field" style={{ maxWidth: 180 }}>
            <label>Date</label>
            <input type="date" value={lever.date ?? ""} onChange={(e) => onChange({ date: e.target.value } as Partial<Lever>)} />
          </div>
        )}

        {lever.mode === "recurring" && (
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ maxWidth: 180 }}>
              <label>Start</label>
              <input type="date" value={lever.startDate ?? ""} onChange={(e) => onChange({ startDate: e.target.value } as Partial<Lever>)} />
            </div>
            <div className="field" style={{ maxWidth: 180 }}>
              <label>End (optional)</label>
              <input type="date" value={lever.endDate ?? ""} onChange={(e) => onChange({ endDate: e.target.value || undefined } as Partial<Lever>)} />
            </div>
          </div>
        )}

        {lever.mode === "schedule" && (
          <div className="lever-billings">
            {billings.length > 0 && (
              <div className="lever-billing-row head">
                <span>Billing date</span>
                <span>Amount</span>
                <span />
              </div>
            )}
            {billings.map((b, bi) => (
              <div className="lever-billing-row" key={bi}>
                <input
                  type="date"
                  value={b.date}
                  onChange={(e) => setBillings(billings.map((x, xi) => (xi === bi ? { ...x, date: e.target.value } : x)))}
                />
                <MoneyInput
                  value={b.amount}
                  step="1000"
                  onChange={(n) => setBillings(billings.map((x, xi) => (xi === bi ? { ...x, amount: n } : x)))}
                />
                <button className="btn sm ghost" onClick={() => setBillings(billings.filter((_, xi) => xi !== bi))} title="Remove billing">✕</button>
              </div>
            ))}
            <div className="row" style={{ gap: 10, marginTop: 6 }}>
              <button className="btn sm" onClick={addBilling}>+ Add billing</button>
              <span className="muted">
                {billings.length === 0
                  ? "No installments yet — this lever adds nothing until one is set."
                  : `${billings.length} installment${billings.length === 1 ? "" : "s"} · each lands as its own receipt`}
              </span>
            </div>
          </div>
        )}
      </>
    );
  }

  if (lever.kind === "hire") {
    return (
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Role</label>
          <input value={lever.role} placeholder="e.g. Sr Engineer" onChange={(e) => onChange({ role: e.target.value } as Partial<Lever>)} />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Annual comp</label>
          <MoneyInput value={lever.annualComp} step="5000" onChange={(n) => onChange({ annualComp: n } as Partial<Lever>)} />
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Start date</label>
          <input type="date" value={lever.startDate} onChange={(e) => onChange({ startDate: e.target.value } as Partial<Lever>)} />
        </div>
      </div>
    );
  }

  // Other legacy lever kinds aren't edited in this builder.
  return <div className="muted" style={{ fontSize: 12 }}>This lever type is edited elsewhere.</div>;
}
