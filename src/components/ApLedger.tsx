"use client";

import { useMemo } from "react";
import type { CashEvent } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * Accounts Payable ledger with per-bill cash-flow controls:
 * - "In CF" checkbox — untick to exclude a bill from the forecast (e.g.
 *   production / passthrough bills for the sister company).
 * - Planned pay date — overrides the due date for cash-flow timing (bill due
 *   Jul 12, paying Jul 30 → cash leaves Jul 30).
 * Adjustments are keyed by bill id, so they survive every re-sync.
 */
export function ApLedger() {
  const { input, syncedApRaw, apAdjustments, setApAdjustment } = useStore();

  const synced = useMemo(
    () => [...(syncedApRaw ?? [])].sort((a, b) => effectiveDate(a, apAdjustments).localeCompare(effectiveDate(b, apAdjustments))),
    [syncedApRaw, apAdjustments],
  );
  const hasSynced = synced.length > 0;

  // Manual rows: AP estimate always; manual accountsPayable only pre-sync.
  const manual = useMemo(
    () =>
      (input.events ?? []).filter(
        (e) => e.category === "apEstimate" || (!hasSynced && e.category === "accountsPayable"),
      ),
    [input, hasSynced],
  );

  const includedTotal = synced
    .filter((e) => !apAdjustments[e.id ?? ""]?.excluded)
    .reduce((s, e) => s + e.amount, 0);
  const excludedTotal = synced
    .filter((e) => apAdjustments[e.id ?? ""]?.excluded)
    .reduce((s, e) => s + e.amount, 0);
  const manualTotal = manual.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Accounts Payable</h2>
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
          Estimate (manual)
          <b className="mono">{fmtMoney(manualTotal)}</b>
        </div>
      </div>

      {!hasSynced && manual.length === 0 ? (
        <div className="muted">No payables — sync from Bill.com, or add estimates in Assumptions.</div>
      ) : (
        <div className="table-scroll">
          <table className="fc">
            <thead>
              <tr>
                <th>Vendor / bill</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Due</th>
                <th style={{ textAlign: "left" }}>Planned pay date</th>
                <th>Amount</th>
                <th title="Include this bill in the cash-flow forecast">In CF</th>
              </tr>
            </thead>
            <tbody>
              {synced.map((e) => {
                const id = e.id ?? "";
                const adj = apAdjustments[id] ?? {};
                const excluded = adj.excluded === true;
                const due = e.originalDate ?? e.date;
                return (
                  <tr key={id} style={excluded ? { opacity: 0.45 } : undefined}>
                    <td>{e.memo ?? "—"}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`chip ${excluded ? "danger" : "info"}`}>
                        {excluded ? "Excluded" : "Scheduled"}
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: "left" }}>{fmtShortDate(due)}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <input
                          type="date"
                          className="cell-date"
                          value={adj.payDate ?? ""}
                          onChange={(ev) => setApAdjustment(id, { payDate: ev.target.value || null })}
                          disabled={excluded}
                          aria-label={`Planned pay date for ${e.memo ?? id}`}
                        />
                        {adj.payDate && (
                          <button className="btn sm ghost" title="Clear override (use due date)" onClick={() => setApAdjustment(id, { payDate: null })}>
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
                        onChange={(ev) => setApAdjustment(id, { excluded: !ev.target.checked })}
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
                    <span className="chip neutral">{e.category === "apEstimate" ? "Estimate" : "Manual"}</span>
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
      <div className="muted" style={{ marginTop: 10 }}>
        Untick <b>In CF</b> to keep a bill out of the forecast (e.g. production / passthrough for the sister
        company). Set a planned pay date when you&apos;ll pay later than the due date — the forecast uses your date.
      </div>
    </div>
  );
}

function effectiveDate(e: CashEvent, adj: Record<string, { payDate?: string }>): string {
  return adj[e.id ?? ""]?.payDate ?? e.date;
}
