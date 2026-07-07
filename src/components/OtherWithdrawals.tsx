"use client";

import type { CashEvent, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";

type Kind = "oneoff" | "recurring";

interface OWRow {
  id: string;
  kind: Kind;
  memo: string;
  amount: number;
  date: string; // one-off funds-out date
  frequency: RecurringFrequency; // recurring cadence
  startDate: string; // recurring start
}

const FREQUENCIES: RecurringFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly"];

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

  // Derive the unified row list from both storage arrays (recurring first).
  const rows: OWRow[] = [
    ...(input.recurring ?? [])
      .filter((r) => r.category === "otherWithdrawals")
      .map((r) => ({
        id: r.id ?? newId(),
        kind: "recurring" as const,
        memo: r.memo ?? "",
        amount: r.amount,
        date: r.startDate,
        frequency: r.frequency,
        startDate: r.startDate,
      })),
    ...(input.events ?? [])
      .filter((e) => e.category === "otherWithdrawals")
      .map((e) => ({
        id: e.id ?? newId(),
        kind: "oneoff" as const,
        memo: e.memo ?? "",
        amount: e.amount,
        date: e.date,
        frequency: "monthly" as RecurringFrequency,
        startDate: e.date,
      })),
  ];

  const total = rows.reduce((s, r) => s + r.amount, 0);

  // Persist: rebuild the otherWithdrawals slices of events + recurring.
  const writeRows = (next: OWRow[]) =>
    setInput((prev) => {
      const keepEvents = (prev.events ?? []).filter((e) => e.category !== "otherWithdrawals");
      const keepRecurring = (prev.recurring ?? []).filter((r) => r.category !== "otherWithdrawals");
      const owEvents: CashEvent[] = next
        .filter((r) => r.kind === "oneoff")
        .map((r) => ({ id: r.id, category: "otherWithdrawals", amount: r.amount, date: r.date, memo: r.memo }));
      const owRecurring: RecurringItem[] = next
        .filter((r) => r.kind === "recurring")
        .map((r) => ({
          id: r.id,
          category: "otherWithdrawals",
          amount: r.amount,
          frequency: r.frequency,
          startDate: r.startDate,
          memo: r.memo,
        }));
      return { ...prev, events: [...keepEvents, ...owEvents], recurring: [...keepRecurring, ...owRecurring] };
    });

  const update = (id: string, patch: Partial<OWRow>) =>
    writeRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => writeRows(rows.filter((r) => r.id !== id));
  const add = () =>
    writeRows([
      ...rows,
      { id: newId(), kind: "oneoff", memo: "", amount: 0, date: anchor, frequency: "monthly", startDate: anchor },
    ]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Other Withdrawals</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(total)}</span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Cash outflows that aren&apos;t operating expense on the books — owner distributions, tax set-asides, and
        recurring payments (e.g. Brandy). These stay manual; recurring amounts are per occurrence.
      </div>

      {rows.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>Nothing yet — add your first below.</div>}

      {rows.map((r) => (
        <div
          className="ow-row"
          key={r.id}
          style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 0.9fr 1.4fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}
        >
          <div className="field">
            <label>Description</label>
            <input value={r.memo} placeholder="e.g. Owner distribution" onChange={(e) => update(r.id, { memo: e.target.value })} />
          </div>
          <div className="field">
            <label>Amount</label>
            <input type="number" value={r.amount} onChange={(e) => update(r.id, { amount: Number(e.target.value) })} />
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
              <label>Funds out</label>
              <input type="date" value={r.date} onChange={(e) => update(r.id, { date: e.target.value })} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
            </div>
          )}
          <button className="btn sm ghost" onClick={() => remove(r.id)} title="Remove">✕</button>
        </div>
      ))}

      <button className="btn sm" onClick={add} style={{ marginTop: 6 }}>
        + Add other withdrawal
      </button>
    </div>
  );
}
