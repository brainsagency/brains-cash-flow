"use client";

import { useState } from "react";
import type { CashCategory, CashEvent, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

type Kind = "oneoff" | "recurring";
type Dir = "out" | "in";

interface OWRow {
  id: string;
  kind: Kind;
  direction: Dir; // out = withdrawal, in = reimbursement / cost-sharing inflow
  memo: string;
  amount: number;
  date: string; // one-off date
  frequency: RecurringFrequency; // recurring cadence
  startDate: string; // recurring start
  endDate?: string; // recurring last occurrence (optional; loans / fixed-term)
}

// Money out lives on the manual `otherWithdrawals` disbursement line; money in
// (cost-sharing reimbursements, e.g. from Mass Culture) rides the manual
// `notInvoiced` receipt line — the one receipt category the QuickBooks sync
// doesn't overwrite, so a manual inflow survives a re-sync.
const OUT_CAT: CashCategory = "otherWithdrawals";
const IN_CAT: CashCategory = "notInvoiced";
const catOf = (d: Dir): CashCategory => (d === "in" ? IN_CAT : OUT_CAT);
const INFLOW = "#1a7f37";

const FREQUENCIES: RecurringFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly"];
const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
};

function newId(): string {
  try {
    return `ow_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `ow_${Math.floor(performance.now())}`;
  }
}

export function OtherWithdrawals() {
  const { input, setInput } = useStore();
  const anchor = input.anchorDate;
  const [editing, setEditing] = useState(false);

  // Derive the unified row list from both storage arrays (recurring first),
  // pulling both the outflow (otherWithdrawals) and inflow (notInvoiced) slices.
  const rows: OWRow[] = [
    ...(input.recurring ?? [])
      .filter((r) => r.category === OUT_CAT || r.category === IN_CAT)
      .map((r) => ({
        id: r.id ?? newId(),
        kind: "recurring" as const,
        direction: (r.category === IN_CAT ? "in" : "out") as Dir,
        memo: r.memo ?? "",
        amount: r.amount,
        date: r.startDate,
        frequency: r.frequency,
        startDate: r.startDate,
        endDate: r.endDate,
      })),
    ...(input.events ?? [])
      .filter((e) => e.category === OUT_CAT || e.category === IN_CAT)
      .map((e) => ({
        id: e.id ?? newId(),
        kind: "oneoff" as const,
        direction: (e.category === IN_CAT ? "in" : "out") as Dir,
        memo: e.memo ?? "",
        amount: e.amount,
        date: e.date,
        frequency: "monthly" as RecurringFrequency,
        startDate: e.date,
      })),
  ];

  const totalOut = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const totalIn = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const net = totalOut - totalIn; // net cash drain from these manual items

  // Persist: rebuild the otherWithdrawals + notInvoiced slices of events + recurring.
  const writeRows = (next: OWRow[]) =>
    setInput((prev) => {
      const keepEvents = (prev.events ?? []).filter((e) => e.category !== OUT_CAT && e.category !== IN_CAT);
      const keepRecurring = (prev.recurring ?? []).filter((r) => r.category !== OUT_CAT && r.category !== IN_CAT);
      const owEvents: CashEvent[] = next
        .filter((r) => r.kind === "oneoff")
        .map((r) => ({ id: r.id, category: catOf(r.direction), amount: r.amount, date: r.date, memo: r.memo }));
      const owRecurring: RecurringItem[] = next
        .filter((r) => r.kind === "recurring")
        .map((r) => ({
          id: r.id,
          category: catOf(r.direction),
          amount: r.amount,
          frequency: r.frequency,
          startDate: r.startDate,
          memo: r.memo,
          ...(r.endDate ? { endDate: r.endDate } : {}),
        }));
      return { ...prev, events: [...keepEvents, ...owEvents], recurring: [...keepRecurring, ...owRecurring] };
    });

  const update = (id: string, patch: Partial<OWRow>) =>
    writeRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => writeRows(rows.filter((r) => r.id !== id));
  const add = (direction: Dir = "out") =>
    writeRows([
      ...rows,
      { id: newId(), kind: "oneoff", direction, memo: "", amount: 0, date: anchor, frequency: "monthly", startDate: anchor },
    ]);

  const meta = (r: OWRow) =>
    r.kind === "recurring"
      ? `${FREQ_LABEL[r.frequency]} from ${fmtShortDate(r.startDate)}${r.endDate ? ` until ${fmtShortDate(r.endDate)}` : ""}`
      : fmtShortDate(r.date);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Other Withdrawals &amp; Reimbursements</h2>
        <div className="spacer" />
        <span className="pill-total mono" style={{ marginRight: 10 }} title="Net cash effect (withdrawals out − reimbursements in)">{fmtMoney(net)}</span>
        {rows.length > 0 && (
          <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Manual cash movements that aren&apos;t on the books — <b>money out</b> (owner distributions, tax set-asides,
        recurring payments like Brandy) and <b>money in</b> (cost-sharing reimbursements, e.g. Mass Culture&apos;s share
        of split payroll). Recurring amounts are per occurrence. The total shows the net drain (out − in).
      </div>

      {rows.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>Nothing yet — add your first below.</div>}

      {/* Read view */}
      {!editing &&
        rows.map((r) => (
          <div className="spec-row" key={r.id}>
            <span className="label">
              {r.memo || <span className="muted">Unlabeled</span>}
              <span className="meta">{meta(r)}{r.direction === "in" ? " · reimbursement" : ""}</span>
            </span>
            <span className="val mono" style={r.direction === "in" ? { color: INFLOW } : undefined}>
              {r.direction === "in" ? "+" : ""}{fmtMoney(r.amount, { cents: true })}
              {r.kind === "recurring" && <span className="sub">/ea</span>}
            </span>
          </div>
        ))}

      {/* Edit view */}
      {editing && (
        <div className="table-scroll">
        {rows.map((r) => (
          <div
            className="ow-row"
            key={r.id}
            style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.4fr) 110px 104px 96px 300px auto", gap: 8, alignItems: "end", marginBottom: 8, minWidth: 820 }}
          >
            <div className="field">
              <label>Description</label>
              <input value={r.memo} placeholder={r.direction === "in" ? "e.g. MC payroll reimbursement" : "e.g. Owner distribution"} onChange={(e) => update(r.id, { memo: e.target.value })} />
            </div>
            <div className="field">
              <label>Amount</label>
              <MoneyInput value={r.amount} onChange={(n) => update(r.id, { amount: n })} />
            </div>
            <div className="field">
              <label>Direction</label>
              <select value={r.direction} onChange={(e) => update(r.id, { direction: e.target.value as Dir })}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
            </div>
            <div className="field">
              <label>Kind</label>
              <select value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as Kind })}>
                <option value="oneoff">One-off</option>
                <option value="recurring">Recurring</option>
              </select>
            </div>
            {r.kind === "oneoff" ? (
              <div className="field">
                <label>{r.direction === "in" ? "Funds in" : "Funds out"}</label>
                <input type="date" value={r.date} onChange={(e) => update(r.id, { date: e.target.value })} />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div className="field">
                  <label>Every</label>
                  <select value={r.frequency} onChange={(e) => update(r.id, { frequency: e.target.value as RecurringFrequency })}>
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Starting</label>
                  <input type="date" value={r.startDate} onChange={(e) => update(r.id, { startDate: e.target.value })} />
                </div>
                <div className="field">
                  <label>Ends (optional)</label>
                  <input type="date" min={r.startDate} value={r.endDate ?? ""} onChange={(e) => update(r.id, { endDate: e.target.value || undefined })} />
                </div>
              </div>
            )}
            <button className="btn sm ghost" onClick={() => remove(r.id)} title="Remove">✕</button>
          </div>
        ))}
        </div>
      )}

      {editing && (
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="btn sm" onClick={() => add("out")}>+ Add withdrawal</button>
          <button className="btn sm ghost" onClick={() => add("in")}>+ Add reimbursement</button>
        </div>
      )}
      {!editing && rows.length === 0 && (
        <button className="btn sm" onClick={() => { setEditing(true); add("out"); }} style={{ marginTop: 6 }}>
          + Add other withdrawal
        </button>
      )}
    </div>
  );
}
