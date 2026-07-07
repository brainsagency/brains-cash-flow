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
