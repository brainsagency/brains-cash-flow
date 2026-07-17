/**
 * Map QuickBooks Online objects to the engine's `CashEvent` shape.
 *
 * - Invoice (AR) → currentAR / overdueAR, dated by the sheet's rule: due date,
 *   or swept to the anchor (first week) if already past due.
 * - Bill (AP)  → accountsPayable (used for QBO↔Bill.com validation, not the
 *   primary forecast feed).
 *
 * Pure and unit-tested against QBO's documented object shapes.
 */

import type { CashEvent } from "@engine/index.js";

type ISODate = string;

interface QboRef {
  name?: string;
  value: string;
}

export interface QboInvoice {
  Id: string;
  Balance?: number; // open/unpaid amount
  DueDate?: string;
  TxnDate?: string;
  DocNumber?: string;
  CustomerRef?: QboRef;
  PrivateNote?: string; // internal "statement memo"
  CustomerMemo?: { value?: string }; // customer-facing message on the invoice
}

/**
 * Memo phrase that marks an invoice as a payroll-reimbursement bill (e.g. Mass
 * Culture's share of split salaries, memo'd "G&A salaries"). When an invoice
 * carries this in its memo, the projected recurring reimbursement receipt yields
 * to the real invoice for that period — see `gateReimbursementReceipts`.
 * (The receipt items themselves are matched by their `mc-reimb-*` ids.)
 */
export const REIMBURSEMENT_MEMO = "G&A salaries";

/** All memo-ish text on an invoice, lowercased, for phrase matching. */
export function invoiceMemoText(inv: QboInvoice): string {
  return [inv.PrivateNote, inv.CustomerMemo?.value].filter(Boolean).join(" ").toLowerCase();
}

/** True when the invoice's memo marks it as a payroll reimbursement. */
export function isReimbursementInvoice(inv: QboInvoice, phrase = REIMBURSEMENT_MEMO): boolean {
  return invoiceMemoText(inv).includes(phrase.toLowerCase());
}

/**
 * Latest transaction date among reimbursement invoices (open or not), or null.
 * The QBO sync advances a persisted high-water mark with this so the projected
 * receipt stays suppressed for a period even after its invoice is paid and
 * drops out of the open-invoice sync.
 */
export function latestReimbursementInvoiceDate(
  invoices: QboInvoice[],
  phrase = REIMBURSEMENT_MEMO,
): ISODate | null {
  let max: ISODate | null = null;
  for (const inv of invoices) {
    if (!isReimbursementInvoice(inv, phrase)) continue;
    const d = inv.TxnDate ?? inv.DueDate;
    if (d && (max === null || d > max)) max = d;
  }
  return max;
}

export interface QboBill {
  Id: string;
  Balance?: number;
  DueDate?: string;
  TxnDate?: string;
  DocNumber?: string;
  VendorRef?: QboRef;
}

function label(ref: QboRef | undefined, docNumber: string | undefined): string {
  const parts: string[] = [];
  if (ref?.name) parts.push(ref.name);
  if (docNumber) parts.push(`#${docNumber}`);
  return parts.length ? parts.join(" ") : "—";
}

/** ISO dates compare correctly as strings. */
function isPast(date: string, anchor: ISODate): boolean {
  return date < anchor;
}

/**
 * Invoice → AR event. Returns null for fully-paid invoices (Balance ≤ 0).
 * Past-due invoices are marked `overdueAR` and dated at the anchor (the sheet
 * sweeps overdue collections into the current week); current ones keep DueDate.
 */
export function mapInvoiceToEvent(inv: QboInvoice, anchor: ISODate): CashEvent | null {
  const amount = inv.Balance ?? 0;
  if (amount <= 0) return null;
  const due = inv.DueDate ?? inv.TxnDate ?? anchor;
  const overdue = isPast(due, anchor);
  return {
    id: `qbo-inv-${inv.Id}`,
    category: overdue ? "overdueAR" : "currentAR",
    amount,
    date: overdue ? anchor : due,
    basis: "committed",
    memo: label(inv.CustomerRef, inv.DocNumber),
  };
}

export function mapInvoices(invoices: QboInvoice[], anchor: ISODate): CashEvent[] {
  return invoices.map((i) => mapInvoiceToEvent(i, anchor)).filter((e): e is CashEvent => e !== null);
}

/** Bill → AP event (validation feed). Null for fully-paid bills. */
export function mapBillToEvent(bill: QboBill, anchor: ISODate): CashEvent | null {
  const amount = bill.Balance ?? 0;
  if (amount <= 0) return null;
  const due = bill.DueDate ?? bill.TxnDate ?? anchor;
  return {
    id: `qbo-bill-${bill.Id}`,
    category: "accountsPayable",
    amount,
    date: isPast(due, anchor) ? anchor : due,
    basis: "committed",
    memo: label(bill.VendorRef, bill.DocNumber),
  };
}

export function mapBills(bills: QboBill[], anchor: ISODate): CashEvent[] {
  return bills.map((b) => mapBillToEvent(b, anchor)).filter((e): e is CashEvent => e !== null);
}
