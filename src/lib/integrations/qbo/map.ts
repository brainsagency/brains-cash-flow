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

export interface QboInvoiceLine {
  Description?: string; // line description ("Salaries Expense for …")
  SalesItemLineDetail?: { ItemRef?: QboRef }; // ItemRef.name is the "ACTIVITY" ("G&A Salaries - MC")
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
  Line?: QboInvoiceLine[]; // line items (activity/description live here)
}

/**
 * Phrase that marks an invoice as a payroll-reimbursement bill (Mass Culture's
 * share of split salaries). On the real invoices it appears in the **line-item
 * activity** ("G&A Salaries - MC", "G&A Salaries - 401(K) - MC", …), not the
 * invoice memo — so matching scans line descriptions/item names too. When an
 * invoice matches, the projected recurring receipt yields to it for that period
 * (see `gateReimbursementReceipts`). Receipt items match by their `mc-reimb-*` ids.
 */
export const REIMBURSEMENT_MEMO = "G&A salaries";

/** All matchable text on an invoice (memo + line activity/description), lowercased. */
export function invoiceMatchText(inv: QboInvoice): string {
  const parts: (string | undefined)[] = [inv.PrivateNote, inv.CustomerMemo?.value];
  for (const line of inv.Line ?? []) {
    parts.push(line.Description, line.SalesItemLineDetail?.ItemRef?.name);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** True when the invoice's memo or line items mark it as a payroll reimbursement. */
export function isReimbursementInvoice(inv: QboInvoice, phrase = REIMBURSEMENT_MEMO): boolean {
  return invoiceMatchText(inv).includes(phrase.toLowerCase());
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
