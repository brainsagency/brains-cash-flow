import { describe, expect, it } from "vitest";
import { mapBill, mapBills } from "./map.js";

const ANCHOR = "2026-07-06";

describe("Bill.com mapBill", () => {
  it("maps an unpaid bill using vendorName, nested invoice number, and dueAmount", () => {
    const e = mapBill(
      {
        id: "00n123",
        amount: 300,
        dueAmount: 225, // partially paid — remaining balance is what hits cash
        dueDate: "2026-08-01",
        invoice: { invoiceNumber: "INV-9" },
        vendorName: "Norton Lumber",
        paymentStatus: "UNPAID",
        archived: false,
      },
      ANCHOR,
    );
    expect(e).toEqual({
      id: "bill-00n123",
      category: "accountsPayable",
      amount: 225,
      date: "2026-08-01",
      basis: "committed",
      originalDate: "2026-08-01",
      memo: "Norton Lumber #INV-9",
    });
  });

  it("excludes archived bills (old/abandoned, not real payables)", () => {
    const e = mapBill(
      { id: "1", amount: 5000, dueAmount: 5000, dueDate: "2019-03-19", paymentStatus: "UNPAID", archived: true },
      ANCHOR,
    );
    expect(e).toBeNull();
  });

  it("skips fully-paid or zero-balance bills", () => {
    expect(mapBill({ id: "1", amount: 100, dueDate: "2026-08-01", paymentStatus: "PAID" }, ANCHOR)).toBeNull();
    expect(mapBill({ id: "2", amount: 100, dueAmount: 0, dueDate: "2026-08-01", paymentStatus: "UNPAID" }, ANCHOR)).toBeNull();
  });

  it("sweeps past-due bills to the anchor, keeping the original due date", () => {
    const e = mapBill({ id: "3", dueAmount: 500, dueDate: "2026-05-01", paymentStatus: "UNPAID" }, ANCHOR);
    expect(e?.date).toBe(ANCHOR);
    expect(e?.originalDate).toBe("2026-05-01");
  });

  it("falls back to amount when dueAmount is absent, and to vendorNames map", () => {
    const e = mapBill(
      { id: "4", amount: 10, dueDate: "2026-09-01", paymentStatus: "UNPAID", vendorId: "009x" },
      ANCHOR,
      { "009x": "Acme" },
    );
    expect(e?.amount).toBe(10);
    expect(e?.memo).toBe("Acme");
  });

  it("batch maps and filters archived + paid", () => {
    const events = mapBills(
      [
        { id: "a", dueAmount: 100, dueDate: "2026-08-01", paymentStatus: "UNPAID" },
        { id: "b", dueAmount: 100, dueDate: "2026-08-01", paymentStatus: "UNPAID", archived: true },
        { id: "c", dueAmount: 50, dueDate: "2026-08-01", paymentStatus: "PAID" },
      ],
      ANCHOR,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("bill-a");
  });
});
