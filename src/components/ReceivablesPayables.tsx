"use client";

import { useMemo } from "react";
import type { CashCategory, CashEvent } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

const AR_CATEGORIES: CashCategory[] = ["overdueAR", "currentAR", "notInvoiced"];
const AP_CATEGORIES: CashCategory[] = ["accountsPayable", "apEstimate"];

const STATUS: Record<string, { label: string; chip: string }> = {
  overdueAR: { label: "Overdue", chip: "danger" },
  currentAR: { label: "Current", chip: "info" },
  notInvoiced: { label: "Not invoiced", chip: "neutral" },
  accountsPayable: { label: "Scheduled", chip: "info" },
  apEstimate: { label: "Estimate", chip: "neutral" },
};

interface LedgerRow {
  key: string;
  name: string;
  statusLabel: string;
  statusChip: string;
  when: string;
  amount: number;
}

function eventRow(e: CashEvent, i: number): LedgerRow {
  const st = STATUS[e.category];
  return {
    key: e.id ?? `e${i}`,
    name: e.memo ?? "—",
    statusLabel: st?.label ?? e.category,
    statusChip: st?.chip ?? "neutral",
    when: fmtShortDate(e.date),
    amount: e.amount,
  };
}

export function ReceivablesPayables({ show = "both" }: { show?: "ar" | "ap" | "both" }) {
  const { input } = useStore();
  const events = useMemo(() => input.events ?? [], [input]);

  const arRows = events.filter((e) => AR_CATEGORIES.includes(e.category)).sort(byDate).map(eventRow);
  const apRows = events.filter((e) => AP_CATEGORIES.includes(e.category)).sort(byDate).map(eventRow);

  const sumOf = (cat: CashCategory) =>
    events.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0);

  const arCard = (
    <LedgerCard
      title="Accounts Receivable"
      rows={arRows}
      entity="Client / project"
      dateLabel="Expected"
      aging={[
        { label: "Current", value: sumOf("currentAR") },
        { label: "Overdue", value: sumOf("overdueAR"), danger: true },
        { label: "Not invoiced", value: sumOf("notInvoiced") },
      ]}
      emptyHint="No receivables — add in Assumptions, or sync from QuickBooks."
    />
  );
  const apCard = (
    <LedgerCard
      title="Accounts Payable"
      rows={apRows}
      entity="Vendor / bill"
      dateLabel="Pay date"
      aging={[
        { label: "Scheduled", value: sumOf("accountsPayable") },
        { label: "Estimate", value: sumOf("apEstimate") },
      ]}
      emptyHint="No payables — add in Assumptions, or sync from Bill.com."
    />
  );
  if (show === "ar") return arCard;
  if (show === "ap") return apCard;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
      {arCard}
      {apCard}
    </div>
  );
}

function LedgerCard({
  title,
  note,
  rows,
  entity,
  dateLabel,
  aging,
  emptyHint,
}: {
  title: string;
  note?: string;
  rows: LedgerRow[];
  entity: string;
  dateLabel: string;
  aging?: Array<{ label: string; value: number; danger?: boolean }>;
  emptyHint: string;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: note ? 6 : 12 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>{title}</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(total)}</span>
      </div>

      {note && <div className="muted" style={{ marginBottom: 12 }}>{note}</div>}

      {aging && aging.length > 0 && (
        <div className="aging">
          {aging.map((a) => (
            <div key={a.label} className={`a ${a.danger && a.value !== 0 ? "danger" : ""}`}>
              {a.label}
              <b className="mono">{fmtMoney(a.value)}</b>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="muted">{emptyHint}</div>
      ) : (
        <div className="table-scroll">
          <table className="fc">
            <thead>
              <tr>
                <th>{entity}</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>{dateLabel}</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td style={{ textAlign: "left" }}>
                    <span className={`chip ${r.statusChip}`}>{r.statusLabel}</span>
                  </td>
                  <td className="mono" style={{ textAlign: "left" }}>{r.when}</td>
                  <td className="mono">{fmtMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function byDate(a: CashEvent, b: CashEvent): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}
