"use client";

import { useMemo, useState } from "react";
import {
  type DisbursementBreakdown,
  type DisbursementCategory,
  type ForecastResult,
  type ReceiptBreakdown,
  type ReceiptCategory,
} from "@engine/index.js";
import { CATEGORY_LABELS, DISBURSEMENT_ORDER, RECEIPT_ORDER } from "@/lib/categories.js";
import { fmtAxisLabel, fmtMoney } from "@/lib/format.js";

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
  return result.periods.map((p) => ({
    label: fmtAxisLabel(p.period.start, view),
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

export function CashMatrix({ result, view }: { result: ForecastResult; view: "week" | "month" }) {
  const [openIn, setOpenIn] = useState(true);
  const [openOut, setOpenOut] = useState(true);

  const cols = useMemo(() => buildColumns(result, view), [result, view]);

  const activeReceipts = RECEIPT_ORDER.filter((c) => cols.some((col) => col.receipts[c] !== 0));
  const activeDisb = DISBURSEMENT_ORDER.filter((c) => cols.some((col) => col.disbursements[c] !== 0));

  return (
    <div className="card">
      <h2 style={{ marginBottom: 12 }}>Breakdown</h2>
      <div className="table-scroll">
        <table className="fc matrix">
          <thead>
            <tr>
              <th>{view === "week" ? "Week of" : "Month"}</th>
              {cols.map((c, i) => (
                <th key={i}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="spine">
              <td>Starting balance</td>
              {cols.map((c, i) => (
                <td key={i} className={`mono ${c.opening < 0 ? "neg" : ""}`}>{cell(c.opening)}</td>
              ))}
            </tr>

            <tr className="group" onClick={() => setOpenIn((v) => !v)}>
              <td>
                <span className="caret">{openIn ? "▾" : "▸"}</span> Income
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

            <tr className="group" onClick={() => setOpenOut((v) => !v)}>
              <td>
                <span className="caret">{openOut ? "▾" : "▸"}</span> Costs
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
              <td>Net cash movement</td>
              {cols.map((c, i) => (
                <td key={i} className={`mono ${c.net < 0 ? "neg" : ""}`}>{cell(c.net)}</td>
              ))}
            </tr>
            <tr className="total closing">
              <td>Ending balance</td>
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
