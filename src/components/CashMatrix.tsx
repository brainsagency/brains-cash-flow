"use client";

import { useMemo, useState } from "react";
import {
  monthlyRollup,
  type DisbursementBreakdown,
  type DisbursementCategory,
  type ForecastResult,
  type ReceiptBreakdown,
  type ReceiptCategory,
} from "@engine/index.js";
import { CATEGORY_LABELS, DISBURSEMENT_ORDER, RECEIPT_ORDER } from "@/lib/categories.js";
import { fmtMoney } from "@/lib/format.js";

interface Column {
  label: string;
  opening: number;
  receipts: ReceiptBreakdown;
  disbursements: DisbursementBreakdown;
  totalReceipts: number;
  totalDisbursements: number;
  net: number;
  closing: number;
}

function buildColumns(result: ForecastResult, view: "week" | "month"): Column[] {
  if (view === "month") {
    return monthlyRollup(result).map((m) => ({
      label: m.month,
      opening: m.beginningBalance,
      receipts: m.receipts,
      disbursements: m.disbursements,
      totalReceipts: m.totalReceipts,
      totalDisbursements: m.totalDisbursements,
      net: m.netFlow,
      closing: m.endingBalance,
    }));
  }
  return result.periods.map((p) => ({
    label: p.period.label.replace("Wk of ", ""),
    opening: p.beginningBalance,
    receipts: p.receipts,
    disbursements: p.disbursements,
    totalReceipts: p.totalReceipts,
    totalDisbursements: p.totalDisbursements,
    net: p.netFlow,
    closing: p.endingBalance,
  }));
}

const cell = (n: number, { blankZero = false }: { blankZero?: boolean } = {}) =>
  blankZero && n === 0 ? "" : fmtMoney(n);

export function CashMatrix({ result }: { result: ForecastResult }) {
  const [view, setView] = useState<"week" | "month">("month");
  const [openIn, setOpenIn] = useState(true);
  const [openOut, setOpenOut] = useState(true);

  const cols = useMemo(() => buildColumns(result, view), [result, view]);

  // Only show category rows that are non-zero somewhere (reduce clutter).
  const activeReceipts = RECEIPT_ORDER.filter((c) => cols.some((col) => col.receipts[c] !== 0));
  const activeDisb = DISBURSEMENT_ORDER.filter((c) => cols.some((col) => col.disbursements[c] !== 0));

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Cash flow</h2>
        <div className="spacer" />
        <div className="row" style={{ gap: 4 }}>
          <button className={`btn sm ${view === "week" ? "primary" : "ghost"}`} onClick={() => setView("week")}>
            Weekly
          </button>
          <button className={`btn sm ${view === "month" ? "primary" : "ghost"}`} onClick={() => setView("month")}>
            Monthly
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="fc matrix">
          <thead>
            <tr>
              <th>{view === "week" ? "Week" : "Month"}</th>
              {cols.map((c, i) => (
                <th key={i}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="spine">
              <td>Opening balance</td>
              {cols.map((c, i) => (
                <td key={i} className={`mono ${c.opening < 0 ? "neg" : ""}`}>{cell(c.opening)}</td>
              ))}
            </tr>

            {/* Cash In */}
            <tr className="group" onClick={() => setOpenIn((v) => !v)}>
              <td>
                <span className="caret">{openIn ? "▾" : "▸"}</span> Cash In
              </td>
              {cols.map((c, i) => (
                <td key={i} className="mono">{cell(c.totalReceipts, { blankZero: true })}</td>
              ))}
            </tr>
            {openIn &&
              activeReceipts.map((cat) => (
                <tr className="sub" key={cat}>
                  <td>{CATEGORY_LABELS[cat as ReceiptCategory]}</td>
                  {cols.map((c, i) => (
                    <td key={i} className="mono faint">{cell(c.receipts[cat], { blankZero: true })}</td>
                  ))}
                </tr>
              ))}

            {/* Cash Out */}
            <tr className="group" onClick={() => setOpenOut((v) => !v)}>
              <td>
                <span className="caret">{openOut ? "▾" : "▸"}</span> Cash Out
              </td>
              {cols.map((c, i) => (
                <td key={i} className="mono">{cell(c.totalDisbursements, { blankZero: true })}</td>
              ))}
            </tr>
            {openOut &&
              activeDisb.map((cat) => (
                <tr className="sub" key={cat}>
                  <td>{CATEGORY_LABELS[cat as DisbursementCategory]}</td>
                  {cols.map((c, i) => (
                    <td key={i} className="mono faint">{cell(c.disbursements[cat], { blankZero: true })}</td>
                  ))}
                </tr>
              ))}

            <tr className="spine">
              <td>Net cash flow</td>
              {cols.map((c, i) => (
                <td key={i} className={`mono ${c.net < 0 ? "neg" : ""}`}>{cell(c.net)}</td>
              ))}
            </tr>
            <tr className="total closing">
              <td>Closing balance</td>
              {cols.map((c, i) => (
                <td key={i} className={`mono ${c.closing < 0 ? "neg" : ""}`}>{cell(c.closing)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
