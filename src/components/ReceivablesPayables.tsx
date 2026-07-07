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

export function ReceivablesPayables() {
  const { input } = useStore();
  const events = useMemo(() => input.events ?? [], [input]);

  const ar = events.filter((e) => AR_CATEGORIES.includes(e.category)).sort(byDate);
  const ap = events.filter((e) => AP_CATEGORIES.includes(e.category)).sort(byDate);

  const sumOf = (cat: CashCategory) =>
    events.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0);

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
      <LedgerCard
        title="Accounts Receivable"
        items={ar}
        total={ar.reduce((s, e) => s + e.amount, 0)}
        entity="Client / project"
        dateLabel="Expected"
        aging={[
          { label: "Current", value: sumOf("currentAR") },
          { label: "Overdue", value: sumOf("overdueAR"), danger: true },
          { label: "Not invoiced", value: sumOf("notInvoiced") },
        ]}
        emptyHint="No receivables — add in Assumptions, or sync from QuickBooks."
      />
      <LedgerCard
        title="Accounts Payable"
        items={ap}
        total={ap.reduce((s, e) => s + e.amount, 0)}
        entity="Vendor / bill"
        dateLabel="Pay date"
        aging={[
          { label: "Scheduled", value: sumOf("accountsPayable") },
          { label: "Estimate", value: sumOf("apEstimate") },
        ]}
        emptyHint="No payables — add in Assumptions, or sync from Bill.com."
      />
    </div>
  );
}

function LedgerCard({
  title,
  items,
  total,
  entity,
  dateLabel,
  aging,
  emptyHint,
}: {
  title: string;
  items: CashEvent[];
  total: number;
  entity: string;
  dateLabel: string;
  aging: Array<{ label: string; value: number; danger?: boolean }>;
  emptyHint: string;
}) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>{title}</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(total)}</span>
      </div>

      <div className="aging">
        {aging.map((a) => (
          <div key={a.label} className={`a ${a.danger && a.value !== 0 ? "danger" : ""}`}>
            {a.label}
            <b className="mono">{fmtMoney(a.value)}</b>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
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
              {items.map((e, i) => {
                const st = STATUS[e.category];
                return (
                  <tr key={e.id ?? i}>
                    <td>{e.memo ?? "—"}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`chip ${st?.chip ?? "neutral"}`}>{st?.label ?? e.category}</span>
                    </td>
                    <td className="mono" style={{ textAlign: "left" }}>{fmtShortDate(e.date)}</td>
                    <td className="mono">{fmtMoney(e.amount)}</td>
                  </tr>
                );
              })}
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
