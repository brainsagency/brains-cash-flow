/**
 * Map BILL (Bill.com) bills to the engine's `CashEvent` shape (AP feed).
 * Bill.com is the AP source of truth; QBO Bills validate it (see reconcile.ts).
 *
 * Verified against the production org: bills carry `vendorName` and
 * `dueAmount` (remaining balance) directly, and old abandoned bills are
 * `archived` rather than marked paid — so archived bills are excluded.
 *
 * Pure and unit-tested.
 */

import type { CashEvent } from "@engine/index.js";

type ISODate = string;

const PAID_STATUSES = new Set(["PAID", "0"]); // exclude fully-paid bills

function label(vendorName: string | undefined, invoiceNumber: string | undefined): string {
  const parts: string[] = [];
  if (vendorName) parts.push(vendorName);
  if (invoiceNumber) parts.push(`#${invoiceNumber}`);
  return parts.length ? parts.join(" ") : "—";
}

export interface BillLike {
  id: string;
  amount?: number;
  /** Remaining unpaid balance — preferred over `amount` when present. */
  dueAmount?: number;
  dueDate?: string;
  invoiceNumber?: string;
  /** v3 nests the vendor invoice number under `invoice`. */
  invoice?: { invoiceNumber?: string };
  vendorId?: string;
  vendorName?: string;
  paymentStatus?: string;
  /** Old/abandoned bills are archived instead of paid — not real payables. */
  archived?: boolean;
}

/**
 * Bill → AP event. Null for archived, fully-paid, or zero-balance bills.
 * Past-due bills are swept to the anchor (paid in the current week), matching
 * the sheet's AP logic. Amount = remaining balance (`dueAmount`).
 */
export function mapBill(
  bill: BillLike,
  anchor: ISODate,
  vendorNames: Record<string, string> = {},
): CashEvent | null {
  if (bill.archived) return null;
  if (bill.paymentStatus && PAID_STATUSES.has(bill.paymentStatus)) return null;
  const amount = bill.dueAmount ?? bill.amount ?? 0;
  if (amount <= 0) return null;
  const due = bill.dueDate ?? anchor;
  const vendorName = bill.vendorName ?? (bill.vendorId ? vendorNames[bill.vendorId] : undefined);
  return {
    id: `bill-${bill.id}`,
    category: "accountsPayable",
    amount,
    date: due < anchor ? anchor : due,
    basis: "committed",
    memo: label(vendorName, bill.invoiceNumber ?? bill.invoice?.invoiceNumber),
  };
}

export function mapBills(
  bills: BillLike[],
  anchor: ISODate,
  vendorNames: Record<string, string> = {},
): CashEvent[] {
  return bills.map((b) => mapBill(b, anchor, vendorNames)).filter((e): e is CashEvent => e !== null);
}
