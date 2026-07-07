/**
 * Monthly roll-up view.
 *
 * The primary forecast timeline is mixed-granularity (weekly near-term, monthly
 * later). For the monthly view the sheet wants, we regroup every period by
 * calendar month and sum the flows. Balances are taken from the period
 * boundaries: a month's beginning balance is its first constituent period's
 * beginning balance, and its ending balance is the last one's ending balance.
 */

import { startOfMonth } from "./dates.js";
import type {
  DisbursementBreakdown,
  ForecastResult,
  ReceiptBreakdown,
} from "./types.js";

export interface MonthlyRow {
  /** "YYYY-MM". */
  month: string;
  beginningBalance: number;
  receipts: ReceiptBreakdown;
  totalReceipts: number;
  disbursements: DisbursementBreakdown;
  totalDisbursements: number;
  netFlow: number;
  endingBalance: number;
}

export function monthlyRollup(result: ForecastResult): MonthlyRow[] {
  const rows = new Map<string, MonthlyRow>();
  const order: string[] = [];

  for (const pf of result.periods) {
    const month = startOfMonth(pf.period.start).slice(0, 7);
    let row = rows.get(month);
    if (!row) {
      row = {
        month,
        beginningBalance: pf.beginningBalance,
        receipts: { ...pf.receipts },
        totalReceipts: 0,
        disbursements: { ...pf.disbursements },
        totalDisbursements: 0,
        netFlow: 0,
        endingBalance: pf.endingBalance,
      };
      rows.set(month, row);
      order.push(month);
    } else {
      addInto(row.receipts, pf.receipts);
      addInto(row.disbursements, pf.disbursements);
      // Ending balance advances to the latest period in the month.
      row.endingBalance = pf.endingBalance;
    }
  }

  // Finalize totals after aggregation.
  for (const row of rows.values()) {
    row.totalReceipts = sum(Object.values(row.receipts));
    row.totalDisbursements = sum(Object.values(row.disbursements));
    row.netFlow = row.totalReceipts - row.totalDisbursements;
  }

  return order.map((m) => rows.get(m)!);
}

function addInto<T extends Record<string, number>>(target: T, src: T): void {
  for (const key of Object.keys(src) as Array<keyof T>) {
    target[key] = ((target[key] ?? 0) + (src[key] ?? 0)) as T[keyof T];
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
