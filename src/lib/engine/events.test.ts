import { describe, expect, it } from "vitest";
import { expandRecurring, pipelineToEvent } from "./events.js";

describe("expandRecurring", () => {
  it("expands weekly items to the horizon end", () => {
    const events = expandRecurring(
      { category: "operatingExpense", amount: 1_000, frequency: "weekly", startDate: "2026-07-06" },
      "2026-07-31",
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });

  it("respects an item's own endDate before the horizon", () => {
    const events = expandRecurring(
      {
        category: "payroll",
        amount: 1_000,
        frequency: "weekly",
        startDate: "2026-07-06",
        endDate: "2026-07-15",
      },
      "2026-12-31",
    );
    expect(events).toHaveLength(2); // 07-06, 07-13
  });

  it("emits semimonthly items on the 1st and 15th", () => {
    const events = expandRecurring(
      { category: "payroll", amount: 5_000, frequency: "semimonthly", startDate: "2026-07-01" },
      "2026-08-20",
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-07-01",
      "2026-07-15",
      "2026-08-01",
      "2026-08-15",
    ]);
  });

  it("expands monthly items, clamping short months", () => {
    const events = expandRecurring(
      { category: "operatingExpense", amount: 1_000, frequency: "monthly", startDate: "2026-01-31" },
      "2026-04-30",
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-28", // clamp carries forward from Feb
      "2026-04-28",
    ]);
  });
});

describe("pipelineToEvent", () => {
  it("lands cash on close + collection lag, carrying probability", () => {
    const e = pipelineToEvent({
      id: "d1",
      name: "Big Co",
      value: 100_000,
      probability: 0.4,
      expectedCloseDate: "2026-07-01",
      collectionLagDays: 45,
    });
    expect(e.date).toBe("2026-08-15");
    expect(e.probability).toBe(0.4);
    expect(e.category).toBe("pipeline");
  });

  it("clamps out-of-range probabilities", () => {
    const e = pipelineToEvent({
      id: "d",
      name: "x",
      value: 1,
      probability: 1.5,
      expectedCloseDate: "2026-07-01",
      collectionLagDays: 0,
    });
    expect(e.probability).toBe(1);
  });
});
