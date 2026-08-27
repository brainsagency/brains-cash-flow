import { describe, expect, it } from "vitest";
import { expandRecurring, type CashEvent, type RecurringItem } from "@engine/index.js";
import {
  applyBillCoverage,
  billVendor,
  coverageByMonth,
  splitBillMemo,
  vendorSummaries,
} from "./coverage.js";

const bill = (memo: string, date: string, amount: number): CashEvent => ({
  id: `bill-${memo}-${date}`,
  category: "accountsPayable",
  amount,
  date,
  memo,
});

const brandy: RecurringItem = {
  id: "ow_brandy",
  category: "otherWithdrawals",
  amount: 18_693,
  frequency: "monthly",
  startDate: "2026-08-01",
  endDate: "2029-06-30",
  memo: "Brandy monthly payment",
  coveredByVendors: ["Brandy Amidon (Buyout)"],
};

const partners: RecurringItem = {
  id: "ow_partners",
  category: "otherWithdrawals",
  amount: 10_662.62,
  frequency: "monthly",
  startDate: "2026-08-01",
  memo: "Partner Distributions",
  coveredByVendors: ["Benjamin Hart", "Maureen Rice", "Drue Flynn"],
};

describe("billVendor / splitBillMemo", () => {
  it("splits the vendor from the invoice number the AP mapping appends", () => {
    expect(billVendor("Brandy Amidon (Buyout) #2026-09-01")).toBe("Brandy Amidon (Buyout)");
    expect(billVendor("Con Edison")).toBe("Con Edison");
    expect(billVendor(undefined)).toBe("");
    expect(splitBillMemo("Benjamin Hart #2026-09-01")).toEqual({ vendor: "Benjamin Hart", num: "2026-09-01" });
    expect(splitBillMemo("—")).toEqual({ vendor: "—", num: "" });
  });
});

describe("vendorSummaries", () => {
  it("rolls bills up per vendor, biggest first, folding case and spacing", () => {
    const out = vendorSummaries([
      bill("Benjamin Hart #1", "2026-09-01", 6_752),
      bill("benjamin  hart #2", "2026-10-01", 6_752),
      bill("Drue Flynn #1", "2026-09-01", 667),
    ]);
    expect(out).toEqual([
      { vendor: "Benjamin Hart", bills: 2, total: 13_504 },
      { vendor: "Drue Flynn", bills: 1, total: 667 },
    ]);
  });
});

describe("coverageByMonth", () => {
  const bills = [
    bill("Brandy Amidon (Buyout) #2026-09-01", "2026-09-01", 18_693),
    bill("Brandy Amidon (Buyout) #2026-10-01", "2026-10-01", 18_693),
    bill("Con Edison #77", "2026-09-04", 1_200),
  ];

  it("totals only the linked vendors, by the month the cash moves", () => {
    expect(coverageByMonth(bills, ["Brandy Amidon (Buyout)"])).toEqual([
      { month: "2026-09", billed: 18_693, bills: 1 },
      { month: "2026-10", billed: 18_693, bills: 1 },
    ]);
  });

  it("follows a pay-date override into the month the cash actually lands", () => {
    // The AP merge rewrites `date` to the planned pay date before we see it.
    const pushed = [bill("Brandy Amidon (Buyout) #2026-09-01", "2026-10-05", 18_693)];
    expect(coverageByMonth(pushed, ["Brandy Amidon (Buyout)"])).toEqual([
      { month: "2026-10", billed: 18_693, bills: 1 },
    ]);
  });

  it("is empty with no vendors linked", () => {
    expect(coverageByMonth(bills, [])).toEqual([]);
  });
});

describe("applyBillCoverage", () => {
  it("nets a fully-billed month out of the projection and leaves the tail alone", () => {
    const bills = [bill("Brandy Amidon (Buyout) #2026-09-01", "2026-09-01", 18_693)];
    const [item] = applyBillCoverage([brandy], bills);
    expect(item!.coveredMonths).toEqual({ "2026-09": 18_693 });

    const events = expandRecurring(item!, "2026-11-30");
    // September is carried by the real bill; August and the tail still project.
    expect(events.map((e) => e.date)).toEqual(["2026-08-01", "2026-10-01", "2026-11-01"]);
    expect(events.every((e) => e.amount === 18_693)).toBe(true);
  });

  it("tops up a partly-billed month instead of dropping it", () => {
    // Only three of the partner bills are in Bill.com so far.
    const bills = [
      bill("Benjamin Hart #2026-09-01", "2026-09-01", 6_752),
      bill("Maureen Rice #2026-09-01", "2026-09-01", 1_182),
      bill("Drue Flynn #2026-09-01", "2026-09-01", 667),
    ];
    const [item] = applyBillCoverage([partners], bills);
    expect(item!.coveredMonths).toEqual({ "2026-09": 8_601 });

    const sept = expandRecurring(item!, "2026-09-30").find((e) => e.date === "2026-09-01");
    expect(sept?.amount).toBeCloseTo(10_662.62 - 8_601, 2);
  });

  it("never turns an over-billed month into a receipt", () => {
    const bills = [bill("Benjamin Hart #2026-09-01", "2026-09-01", 99_000)];
    const [item] = applyBillCoverage([partners], bills);
    const sept = expandRecurring(item!, "2026-09-30").filter((e) => e.date.startsWith("2026-09"));
    expect(sept).toEqual([]);
  });

  it("spreads one month's coverage across a semi-monthly item's occurrences", () => {
    const semi: RecurringItem = { ...partners, frequency: "semimonthly", amount: 5_000 };
    const bills = [bill("Benjamin Hart #2026-09-01", "2026-09-01", 7_000)];
    const [item] = applyBillCoverage([semi], bills);
    const events = expandRecurring(item!, "2026-09-30").filter((e) => e.date.startsWith("2026-09"));
    // 7,000 eats the 1st entirely and 2,000 of the 15th.
    expect(events).toHaveLength(1);
    expect(events[0]!.date).toBe("2026-09-15");
    expect(events[0]!.amount).toBe(3_000);
  });

  it("leaves unlinked items, receipts, and empty feeds untouched", () => {
    const unlinked: RecurringItem = { ...brandy, coveredByVendors: undefined };
    const receipt: RecurringItem = { ...partners, category: "notInvoiced" };
    const bills = [bill("Brandy Amidon (Buyout) #2026-09-01", "2026-09-01", 18_693)];
    expect(applyBillCoverage([unlinked], bills)[0]).toBe(unlinked);
    expect(applyBillCoverage([receipt], bills)[0]).toBe(receipt);
    expect(applyBillCoverage([brandy], [])[0]).toBe(brandy);
  });

  it("clears a stale deduction once the bills are gone (paid, or unlinked)", () => {
    const stale: RecurringItem = { ...brandy, coveredMonths: { "2026-08": 18_693 } };
    expect(applyBillCoverage([stale], [])[0]!.coveredMonths).toBeUndefined();
    expect(
      applyBillCoverage([{ ...stale, coveredByVendors: [] }], [])[0]!.coveredMonths,
    ).toBeUndefined();
  });
});
