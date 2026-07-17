import { describe, expect, it } from "vitest";
import type { RecurringItem } from "@engine/index.js";
import { gateReimbursementReceipts, isReimbursementReceipt } from "./reimbursement.js";
import { isReimbursementInvoice, latestReimbursementInvoiceDate, type QboInvoice } from "./map.js";

const receipt = (id: string, startDate: string, memo = "MC G&A salaries"): RecurringItem => ({
  id,
  category: "notInvoiced",
  amount: 15_673,
  frequency: "monthly",
  startDate,
  memo,
});

describe("isReimbursementReceipt", () => {
  it("matches mc-reimb ids and memo-tagged notInvoiced items; nothing else", () => {
    expect(isReimbursementReceipt(receipt("mc-reimb-1st", "2026-07-11", ""))).toBe(true);
    expect(isReimbursementReceipt(receipt("x", "2026-07-11", "G&A salaries"))).toBe(true);
    expect(isReimbursementReceipt(receipt("x", "2026-07-11", "office supplies"))).toBe(false);
    expect(
      isReimbursementReceipt({ id: "ar", category: "currentAR", amount: 1, frequency: "monthly", startDate: "2026-07-01" }),
    ).toBe(false);
  });
});

describe("gateReimbursementReceipts", () => {
  const items = [receipt("mc-reimb-1st", "2026-07-11"), receipt("mc-reimb-15th", "2026-07-25")];
  const start = (out: RecurringItem[], id: string) => out.find((i) => i.id === id)!.startDate;

  it("passes through untouched when nothing has been invoiced yet", () => {
    expect(gateReimbursementReceipts(items, null)).toEqual(items);
  });

  it("advances receipts past a fully-invoiced period, preserving day-of-month", () => {
    // Invoiced through 07-15 → both July receipts covered → jump to August, same days.
    const out = gateReimbursementReceipts(items, "2026-07-15");
    expect(start(out, "mc-reimb-1st")).toBe("2026-08-11");
    expect(start(out, "mc-reimb-15th")).toBe("2026-08-25");
  });

  it("only suppresses periods actually invoiced (staggered)", () => {
    // Invoiced through only 07-01 → the 07-11 receipt is covered, the 07-25 isn't.
    const out = gateReimbursementReceipts(items, "2026-07-01");
    expect(start(out, "mc-reimb-1st")).toBe("2026-08-11");
    expect(start(out, "mc-reimb-15th")).toBe("2026-07-25");
  });

  it("never moves a receipt earlier than its own start", () => {
    expect(gateReimbursementReceipts(items, "2026-06-01")).toEqual(items);
  });

  it("leaves non-reimbursement recurring items alone", () => {
    const opex: RecurringItem = { id: "opex", category: "operatingExpense", amount: 100, frequency: "monthly", startDate: "2026-07-01" };
    expect(gateReimbursementReceipts([opex], "2026-07-15")[0]).toEqual(opex);
  });
});

describe("reimbursement invoice detection", () => {
  // Real shape (Invoice 14074): the phrase is in the line-item activity, not the memo.
  const lineInv = (Id: string, TxnDate: string, activity: string): QboInvoice => ({
    Id,
    Balance: 17_682.44,
    TxnDate,
    Line: [{ Description: `Salaries Expense for ${TxnDate}`, SalesItemLineDetail: { ItemRef: { value: "1", name: activity } } }],
  });

  it("matches the phrase in line-item activity (the real invoice shape)", () => {
    expect(isReimbursementInvoice(lineInv("1", "2026-06-30", "G&A Salaries - MC"))).toBe(true);
    expect(isReimbursementInvoice(lineInv("2", "2026-06-30", "G&A Salaries - 401(K) - MC"))).toBe(true);
  });

  it("still matches the phrase in the invoice memo fields", () => {
    expect(isReimbursementInvoice({ Id: "3", Balance: 1, PrivateNote: "G&A salaries — Ben" })).toBe(true);
    expect(isReimbursementInvoice({ Id: "4", Balance: 1, CustomerMemo: { value: "G&A salaries" } })).toBe(true);
  });

  it("does not match a real project invoice", () => {
    expect(isReimbursementInvoice(lineInv("5", "2026-08-01", "Website redesign — phase 2"))).toBe(false);
  });

  it("latest date ignores non-reimbursement invoices", () => {
    const invs = [
      lineInv("1", "2026-06-15", "G&A Salaries - MC"),
      lineInv("2", "2026-06-30", "G&A Salaries - MC"),
      lineInv("3", "2026-08-01", "Project work"), // real revenue, not a reimbursement
    ];
    expect(latestReimbursementInvoiceDate(invs)).toBe("2026-06-30");
  });
});
