/**
 * Reconcile a projected recurring withdrawal against the real bills that
 * eventually stand in for it, so the two never double-count.
 *
 * Some money out is modelled twice by design: as a manual recurring line in
 * Other Withdrawals (the Brandy buyout, partner distributions), which projects
 * out for years, and — once the month comes around — as an actual Bill.com bill
 * that only ever exists for the near term. Both land in the forecast, so the
 * current month gets charged twice while the tail is projection-only.
 *
 * Linking the vendors to the recurring line (`coveredByVendors`) fixes it in
 * the direction that keeps the most accuracy: the real bills win the months
 * they cover, the projection tops up the difference when only some of the bills
 * have been entered, and it carries the tail on its own once the AP feed runs
 * out. Same shape as `gateReimbursementReceipts` on the receipts side.
 *
 * Pure and unit-tested.
 */

import { directionOf, type CashEvent, type RecurringItem } from "@engine/index.js";

/**
 * The vendor half of a bill's memo, which the AP mapping writes as
 * "Vendor Name #invoice-number" (see `mapBill`). Bills with no invoice number
 * are just the vendor name.
 */
export function billVendor(memo: string | undefined): string {
  const m = (memo ?? "").match(/^(.*?)\s*#(\S+)\s*$/);
  return (m ? m[1]! : (memo ?? "")).trim();
}

/** Vendor + invoice number, for ledgers that show them in separate columns. */
export function splitBillMemo(memo: string | undefined): { vendor: string; num: string } {
  const m = (memo ?? "").match(/^(.*?)\s*#(\S+)\s*$/);
  return m ? { vendor: m[1]!.trim(), num: m[2]! } : { vendor: (memo ?? "").trim(), num: "" };
}

/** Case- and whitespace-insensitive vendor key, so a link survives cosmetic drift. */
export function vendorKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface VendorSummary {
  /** Vendor name as the feed spells it. */
  vendor: string;
  bills: number;
  total: number;
}

/**
 * Distinct vendors in an AP feed, with their open-bill count and total —
 * the option list behind the "covered by" picker. Sorted by total, biggest
 * first, since the lines worth linking are the big recurring ones.
 */
export function vendorSummaries(bills: CashEvent[]): VendorSummary[] {
  const byKey = new Map<string, VendorSummary>();
  for (const bill of bills) {
    const vendor = billVendor(bill.memo);
    if (!vendor) continue;
    const key = vendorKey(vendor);
    const cur = byKey.get(key);
    if (cur) {
      cur.bills += 1;
      cur.total += bill.amount;
    } else {
      byKey.set(key, { vendor, bills: 1, total: bill.amount });
    }
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total || a.vendor.localeCompare(b.vendor));
}

export interface MonthCoverage {
  /** Calendar month, "YYYY-MM". */
  month: string;
  /** Total of the matching bills landing in that month. */
  billed: number;
  /** How many bills that is. */
  bills: number;
}

/**
 * Bills from `vendors`, totalled by the month their cash actually moves — the
 * planned pay date where one is set, otherwise the due date. Matching the month
 * of the *cash* (not the bill's own due date) is what keeps a month's total
 * right when a bill is pushed into the next one.
 */
export function coverageByMonth(bills: CashEvent[], vendors: string[]): MonthCoverage[] {
  const wanted = new Set(vendors.map(vendorKey).filter(Boolean));
  if (wanted.size === 0) return [];
  const byMonth = new Map<string, MonthCoverage>();
  for (const bill of bills) {
    if (!wanted.has(vendorKey(billVendor(bill.memo)))) continue;
    const month = bill.date.slice(0, 7);
    const cur = byMonth.get(month);
    if (cur) {
      cur.billed += bill.amount;
      cur.bills += 1;
    } else {
      byMonth.set(month, { month, billed: bill.amount, bills: 1 });
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Resolve every linked recurring item's `coveredByVendors` into the per-month
 * deductions the engine applies (`coveredMonths`).
 *
 * `bills` must be the AP events as they will actually enter the forecast —
 * after exclusions and pay-date overrides. That falls out right: un-ticking a
 * bill in the AP ledger removes its coverage too, so the projection comes back
 * for that month instead of the month silently going missing.
 */
export function applyBillCoverage(items: RecurringItem[], bills: CashEvent[]): RecurringItem[] {
  return items.map((item) => {
    const vendors = item.coveredByVendors ?? [];
    if (vendors.length === 0 || directionOf(item.category) !== "out") {
      return item.coveredMonths ? stripCoverage(item) : item;
    }
    const months = coverageByMonth(bills, vendors);
    if (months.length === 0) return item.coveredMonths ? stripCoverage(item) : item;
    const coveredMonths: Record<string, number> = {};
    for (const m of months) coveredMonths[m.month] = m.billed;
    return { ...item, coveredMonths };
  });
}

/** Drop a stale deduction (the link was removed, or its bills all got paid). */
function stripCoverage(item: RecurringItem): RecurringItem {
  const next = { ...item };
  delete next.coveredMonths;
  return next;
}
