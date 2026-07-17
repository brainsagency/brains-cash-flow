/**
 * Reconcile the projected payroll-reimbursement receipt against the real MC
 * invoices, so the two never double-count.
 *
 * The forecast carries a recurring `notInvoiced` receipt that projects MC's
 * share of split salaries (~10 days after each payroll). Once MC issues the
 * actual invoice, that real invoice (kept as AR, self-reconciling on payment)
 * should take over for its period. The QBO sync tracks a high-water mark of the
 * latest reimbursement-invoice date (`invoicedThrough`); here we advance each
 * projected receipt past it so covered periods drop while the future projection
 * stays.
 */

import { addDays, firstMonthlyOccurrenceAfter, type ISODate, type RecurringItem } from "@engine/index.js";
import { REIMBURSEMENT_MEMO } from "./map.js";

/**
 * Buffer past a payroll date used as the suppression cutoff. Receipts land ~10
 * days after each 1st/15th payroll; 12 days catches the matching receipt for an
 * invoice dated near payroll without reaching the next occurrence (~14 days out).
 */
export const REIMBURSEMENT_LAG_DAYS = 12;

/**
 * A recurring receipt that projects a payroll reimbursement. Matches the live
 * `mc-reimb-*` items by id, or anything tagged with the memo phrase.
 */
export function isReimbursementReceipt(item: RecurringItem, phrase = REIMBURSEMENT_MEMO): boolean {
  if (item.category !== "notInvoiced") return false;
  if ((item.id ?? "").startsWith("mc-reimb")) return true;
  return (item.memo ?? "").toLowerCase().includes(phrase.toLowerCase());
}

/**
 * Advance each projected reimbursement receipt past the invoiced-through mark so
 * periods MC has already invoiced don't double-count with those invoices (or,
 * once paid, with the bank balance). Non-reimbursement items — and the case
 * where nothing has been invoiced yet — pass through unchanged.
 */
export function gateReimbursementReceipts(
  items: RecurringItem[],
  invoicedThrough: ISODate | null | undefined,
  phrase = REIMBURSEMENT_MEMO,
): RecurringItem[] {
  if (!invoicedThrough) return items;
  const cutoff = addDays(invoicedThrough, REIMBURSEMENT_LAG_DAYS);
  return items.map((it) => {
    if (!isReimbursementReceipt(it, phrase)) return it;
    const day = Number(it.startDate.slice(8, 10)) || 1;
    const floor = firstMonthlyOccurrenceAfter(day, cutoff);
    return floor > it.startDate ? { ...it, startDate: floor } : it;
  });
}
