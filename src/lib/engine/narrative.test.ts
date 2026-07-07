import { describe, expect, it } from "vitest";
import { forecast } from "./forecast.js";
import { narrate } from "./narrative.js";

describe("narrate", () => {
  it("summarizes cash, burn, runway, and alerts in plain English", () => {
    const result = forecast({
      anchorDate: "2026-07-06",
      bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 100_000 }],
      recurring: [
        { category: "operatingExpense", amount: 40_000, frequency: "monthly", startDate: "2026-07-06" },
      ],
    });
    const text = narrate(result);
    expect(text).toContain("Starting cash is $100,000");
    expect(text).toContain("burn");
    expect(text).toMatch(/runs out|stays positive/);
  });

  it("states cash stays positive when it never goes negative", () => {
    const result = forecast({
      anchorDate: "2026-07-06",
      bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 10_000_000 }],
    });
    expect(narrate(result)).toContain("stays positive");
  });
});
