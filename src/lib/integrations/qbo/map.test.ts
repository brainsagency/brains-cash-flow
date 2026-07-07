import { describe, expect, it } from "vitest";
import { mapBills, mapBillToEvent, mapInvoices, mapInvoiceToEvent } from "./map.js";

const ANCHOR = "2026-07-06";

describe("mapInvoiceToEvent (AR)", () => {
  it("maps a current invoice to currentAR on its due date", () => {
    const e = mapInvoiceToEvent(
      { Id: "12", Balance: 35000, DueDate: "2026-07-31", DocNumber: "1042", CustomerRef: { name: "Reel Products", value: "26" } },
      ANCHOR,
    );
    expect(e).toEqual({
      id: "qbo-inv-12",
      category: "currentAR",
      amount: 35000,
      date: "2026-07-31",
      basis: "committed",
      memo: "Reel Products #1042",
    });
  });

  it("marks a past-due invoice overdueAR and sweeps it to the anchor", () => {
    const e = mapInvoiceToEvent({ Id: "9", Balance: 20000, DueDate: "2026-06-01", CustomerRef: { name: "Acme", value: "5" } }, ANCHOR);
    expect(e?.category).toBe("overdueAR");
    expect(e?.date).toBe(ANCHOR); // swept into the current week
  });

  it("uses the open Balance, not the total, and skips fully-paid invoices", () => {
    expect(mapInvoiceToEvent({ Id: "1", Balance: 0, DueDate: "2026-08-01" }, ANCHOR)).toBeNull();
    const partial = mapInvoiceToEvent({ Id: "2", Balance: 5000, DueDate: "2026-08-01" }, ANCHOR);
    expect(partial?.amount).toBe(5000);
  });

  it("falls back to TxnDate, then anchor, when DueDate is missing", () => {
    expect(mapInvoiceToEvent({ Id: "3", Balance: 100, TxnDate: "2026-09-09" }, ANCHOR)?.date).toBe("2026-09-09");
    expect(mapInvoiceToEvent({ Id: "4", Balance: 100 }, ANCHOR)?.date).toBe(ANCHOR);
  });

  it("filters nulls in the batch mapper", () => {
    const events = mapInvoices(
      [
        { Id: "a", Balance: 0, DueDate: "2026-08-01" },
        { Id: "b", Balance: 1000, DueDate: "2026-08-01" },
      ],
      ANCHOR,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("qbo-inv-b");
  });
});

describe("mapBillToEvent (AP validation)", () => {
  it("maps an open bill to accountsPayable on its due date", () => {
    // From QBO's documented Bill sample shape.
    const e = mapBillToEvent(
      { Id: "150", Balance: 225, DueDate: "2026-10-07", VendorRef: { name: "Norton Lumber and Building Materials", value: "46" } },
      ANCHOR,
    );
    expect(e).toEqual({
      id: "qbo-bill-150",
      category: "accountsPayable",
      amount: 225,
      date: "2026-10-07",
      basis: "committed",
      memo: "Norton Lumber and Building Materials",
    });
  });

  it("skips fully-paid bills (Balance 0) and sweeps overdue to anchor", () => {
    expect(mapBillToEvent({ Id: "25", Balance: 0, DueDate: "2026-06-01" }, ANCHOR)).toBeNull();
    const overdue = mapBillToEvent({ Id: "7", Balance: 500, DueDate: "2026-05-01", VendorRef: { name: "Bob", value: "1" } }, ANCHOR);
    expect(overdue?.date).toBe(ANCHOR);
  });

  it("batch maps bills", () => {
    const events = mapBills([{ Id: "1", Balance: 100, DueDate: "2026-08-01" }], ANCHOR);
    expect(events).toHaveLength(1);
    expect(events[0]!.category).toBe("accountsPayable");
  });
});
