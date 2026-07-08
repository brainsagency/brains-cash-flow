"use client";

import { useMemo } from "react";
import type { CashCategory, CashEvent } from "@engine/index.js";
import { useStore, type Adjustment } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * Synced ledger (AR invoices or AP bills) with per-item cash-flow controls:
 * - "In CF" checkbox — untick to exclude an item from the forecast (a disputed
 *   invoice, or a production/passthrough bill for the sister company).
 * - Date override — the expected collection date (AR) or planned pay date (AP)
 *   when it differs from the invoice/bill due date.
 * Adjustments are keyed by event id, so they survive every re-sync.
 */

type Kind = "ar" | "ap";

interface Config {
  title: string;
  entity: string;
  overrideLabel: string;
  manualLabel: string;
  emptyHint: string;
  note: string;
  owned: CashCategory[]; // categories the sync owns (manual shown only pre-sync)
  manualCats: CashCategory[]; // always-manual categories (e.g. estimates)
}

const CONFIG: Record<Kind, Config> = {
  ar: {
    title: "Accounts Receivable",
    entity: "Client / project",
    overrideLabel: "Expected collection",
    manualLabel: "Not invoiced",
    emptyHint: "No receivables — sync from QuickBooks, or add items in Assumptions.",
    note: "Untick In CF to leave an invoice out of the forecast (e.g. disputed, or a passthrough). Set an expected collection date when you expect payment later than the due date — the forecast uses your date.",
    owned: ["currentAR", "overdueAR"],
    manualCats: ["notInvoiced"],
  },
  ap: {
    title: "Accounts Payable",
    entity: "Vendor / bill",
    overrideLabel: "Planned pay date",
    manualLabel: "Estimate",
    emptyHint: "No payables — sync from Bill.com, or add estimates in Assumptions.",
    note: "Untick In CF to keep a bill out of the forecast (e.g. production / passthrough for the sister company). Set a planned pay date when you'll pay later than the due date — the forecast uses your date.",
    owned: ["accountsPayable"],
    manualCats: ["apEstimate"],
  },
};

function effectiveDate(e: CashEvent, adj: Record<string, Adjustment>): string {
  const a = adj[e.id ?? ""];
  return a?.date ?? a?.payDate ?? e.date;
}

function syncedStatus(kind: Kind, e: CashEvent): { label: string; chip: string } {
  if (kind === "ap") return { label: "Scheduled", chip: "info" };
  return e.category === "overdueAR" ? { label: "Overdue", chip: "danger" } : { label: "Current", chip: "info" };
}

export function SyncedLedger({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const { input, syncedArRaw, syncedApRaw, adjustments, setAdjustment } = useStore();
  const syncedRaw = kind === "ar" ? syncedArRaw : syncedApRaw;

  const synced = useMemo(
    () => [...(syncedRaw ?? [])].sort((a, b) => effectiveDate(a, adjustments).localeCompare(effectiveDate(b, adjustments))),
    [syncedRaw, adjustments],
  );
  const hasSynced = synced.length > 0;

  const manual = useMemo(
    () =>
      (input.events ?? []).filter(
        (e) => cfg.manualCats.includes(e.category) || (!hasSynced && cfg.owned.includes(e.category)),
      ),
    [input, hasSynced, cfg],
  );

  const includedTotal = synced.filter((e) => !adjustments[e.id ?? ""]?.excluded).reduce((s, e) => s + e.amount, 0);
  const excludedTotal = synced.filter((e) => adjustments[e.id ?? ""]?.excluded).reduce((s, e) => s + e.amount, 0);
  const manualTotal = manual.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>{cfg.title}</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(includedTotal + manualTotal)}</span>
      </div>

      <div className="aging">
        <div className="a">
          In cash flow
          <b className="mono">{fmtMoney(includedTotal)}</b>
        </div>
        <div className={`a ${excludedTotal > 0 ? "danger" : ""}`}>
          Excluded
          <b className="mono">{fmtMoney(excludedTotal)}</b>
        </div>
        <div className="a">
          {cfg.manualLabel}
          <b className="mono">{fmtMoney(manualTotal)}</b>
        </div>
      </div>

      {!hasSynced && manual.length === 0 ? (
        <div className="muted">{cfg.emptyHint}</div>
      ) : (
        <div className="table-scroll">
          <table className="fc">
            <thead>
              <tr>
                <th>{cfg.entity}</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Due</th>
                <th style={{ textAlign: "left" }}>{cfg.overrideLabel}</th>
                <th>Amount</th>
                <th title="Include this item in the cash-flow forecast">In CF</th>
              </tr>
            </thead>
            <tbody>
              {synced.map((e) => {
                const id = e.id ?? "";
                const adj = adjustments[id] ?? {};
                const excluded = adj.excluded === true;
                const override = adj.date ?? adj.payDate ?? "";
                const st = excluded ? { label: "Excluded", chip: "danger" } : syncedStatus(kind, e);
                return (
                  <tr key={id} style={excluded ? { opacity: 0.45 } : undefined}>
                    <td>{e.memo ?? "—"}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`chip ${st.chip}`}>{st.label}</span>
                    </td>
                    <td className="mono" style={{ textAlign: "left" }}>{fmtShortDate(e.originalDate ?? e.date)}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <input
                          type="date"
                          className="cell-date"
                          value={override}
                          onChange={(ev) => setAdjustment(id, { date: ev.target.value || null })}
                          disabled={excluded}
                          aria-label={`${cfg.overrideLabel} for ${e.memo ?? id}`}
                        />
                        {override && (
                          <button className="btn sm ghost" title="Clear override (use due date)" onClick={() => setAdjustment(id, { date: null })}>
                            ✕
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="mono">{fmtMoney(e.amount)}</td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={(ev) => setAdjustment(id, { excluded: !ev.target.checked })}
                        aria-label={`Include ${e.memo ?? id} in cash flow`}
                      />
                    </td>
                  </tr>
                );
              })}
              {manual.map((e, i) => (
                <tr key={e.id ?? `m${i}`}>
                  <td>{e.memo ?? "—"}</td>
                  <td style={{ textAlign: "left" }}>
                    <span className="chip neutral">{cfg.manualCats.includes(e.category) ? cfg.manualLabel : "Manual"}</span>
                  </td>
                  <td className="mono" style={{ textAlign: "left" }}>{fmtShortDate(e.date)}</td>
                  <td style={{ textAlign: "left" }} className="muted">—</td>
                  <td className="mono">{fmtMoney(e.amount)}</td>
                  <td style={{ textAlign: "center" }} className="muted">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ marginTop: 10 }}>{cfg.note}</div>
    </div>
  );
}
