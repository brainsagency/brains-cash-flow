import { describe, expect, it } from "vitest";
import { forecast } from "./forecast.js";
import { monthlyRollup } from "./rollup.js";
import type { ForecastInput } from "./types.js";

const ANCHOR = "2026-07-06";

describe("monthlyRollup", () => {
  const input: ForecastInput = {
    anchorDate: ANCHOR,
    bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 100_000 }],
    events: [
      { category: "currentAR", amount: 20_000, date: "2026-07-08" }, // July, week 0
      { category: "currentAR", amount: 25_000, date: "2026-07-22" }, // July, week 2
      { category: "payroll", amount: 10_000, date: "2026-07-15" }, // July, week 1
    ],
  };

  const result = forecast(input);
  const rows = monthlyRollup(result);

  it("groups weekly periods into their calendar month", () => {
    const july = rows.find((r) => r.month === "2026-07")!;
    expect(july).toBeDefined();
    // 20k + 25k received, 10k paid, all in July weeks.
    expect(july.totalReceipts).toBe(45_000);
    expect(july.receipts.currentAR).toBe(45_000);
    expect(july.totalDisbursements).toBe(10_000);
    expect(july.netFlow).toBe(35_000);
  });

  it("preserves period-boundary balances within a month", () => {
    const july = rows.find((r) => r.month === "2026-07")!;
    expect(july.beginningBalance).toBe(100_000); // first July week's beginning
    // Ending after all July activity = 100k + 45k − 10k.
    expect(july.endingBalance).toBe(135_000);
  });

  it("covers every calendar month in the horizon exactly once", () => {
    const months = rows.map((r) => r.month);
    expect(new Set(months).size).toBe(months.length);
  });
});
