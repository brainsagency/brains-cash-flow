/**
 * Map BILL (Bill.com) bills to the engine's `CashEvent` shape (AP feed).
 * Bill.com is the AP source of truth; QBO Bills validate it (see reconcile.ts).
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
  dueDate?: string;
  invoiceNumber?: string;
  vendorId?: string;
  paymentStatus?: string;
}

/**
 * Bill → AP event. Null for fully-paid or zero bills. Past-due bills are swept
 * to the anchor (paid in the current week), matching the sheet's AP logic.
 */
export function mapBill(
  bill: BillLike,
  anchor: ISODate,
  vendorNames: Record<string, string> = {},
): CashEvent | null {
  if (bill.paymentStatus && PAID_STATUSES.has(bill.paymentStatus)) return null;
  const amount = bill.amount ?? 0;
  if (amount <= 0) return null;
  const due = bill.dueDate ?? anchor;
  const vendorName = bill.vendorId ? vendorNames[bill.vendorId] : undefined;
  return {
    id: `bill-${bill.id}`,
    category: "accountsPayable",
    amount,
    date: due < anchor ? anchor : due,
    basis: "committed",
    memo: label(vendorName, bill.invoiceNumber),
  };
}

export function mapBills(
  bills: BillLike[],
  anchor: ISODate,
  vendorNames: Record<string, string> = {},
): CashEvent[] {
  return bills.map((b) => mapBill(b, anchor, vendorNames)).filter((e): e is CashEvent => e !== null);
}
