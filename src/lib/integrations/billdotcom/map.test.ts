import { describe, expect, it } from "vitest";
import { mapBill, mapBills } from "./map.js";

const ANCHOR = "2026-07-06";
const VENDORS = { "009abc": "Norton Lumber" };

describe("Bill.com mapBill", () => {
  it("maps an unpaid bill to accountsPayable on its due date with vendor name", () => {
    const e = mapBill(
      { id: "00n123", amount: 225, dueDate: "2026-08-01", invoiceNumber: "INV-9", vendorId: "009abc", paymentStatus: "UNPAID" },
      ANCHOR,
      VENDORS,
    );
    expect(e).toEqual({
      id: "bill-00n123",
      category: "accountsPayable",
      amount: 225,
      date: "2026-08-01",
      basis: "committed",
      memo: "Norton Lumber #INV-9",
    });
  });

  it("skips fully-paid or zero bills", () => {
    expect(mapBill({ id: "1", amount: 100, dueDate: "2026-08-01", paymentStatus: "PAID" }, ANCHOR)).toBeNull();
    expect(mapBill({ id: "2", amount: 0, dueDate: "2026-08-01", paymentStatus: "UNPAID" }, ANCHOR)).toBeNull();
  });

  it("sweeps past-due bills to the anchor", () => {
    const e = mapBill({ id: "3", amount: 500, dueDate: "2026-05-01", paymentStatus: "UNPAID" }, ANCHOR);
    expect(e?.date).toBe(ANCHOR);
  });

  it("falls back to vendorId label when no name and no invoice number", () => {
    const e = mapBill({ id: "4", amount: 10, dueDate: "2026-09-01", paymentStatus: "UNPAID" }, ANCHOR);
    expect(e?.memo).toBe("—");
  });

  it("batch maps and filters", () => {
    const events = mapBills(
      [
        { id: "a", amount: 100, dueDate: "2026-08-01", paymentStatus: "UNPAID" },
        { id: "b", amount: 0, dueDate: "2026-08-01", paymentStatus: "UNPAID" },
        { id: "c", amount: 50, dueDate: "2026-08-01", paymentStatus: "PAID" },
      ],
      ANCHOR,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("bill-a");
  });
});
