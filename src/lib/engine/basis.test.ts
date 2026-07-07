import { describe, expect, it } from "vitest";
import { forecast } from "./forecast.js";
import type { ForecastInput } from "./types.js";

const ANCHOR = "2026-07-06";

function base(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    anchorDate: ANCHOR,
    bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 100_000 }],
    ...overrides,
  };
}

describe("basis: committed vs budgeted", () => {
  const input = base({
    events: [
      { category: "operatingExpense", amount: 10_000, date: "2026-07-08" }, // committed (default)
      { category: "operatingExpense", amount: 5_000, date: "2026-07-08", basis: "budgeted" },
    ],
    recurring: [
      { category: "payroll", amount: 30_000, frequency: "monthly", startDate: ANCHOR, basis: "budgeted" },
    ],
  });

  it("excludes budgeted streams by default (committed-only forecast)", () => {
    const result = forecast(input);
    // Only the $10k committed opex in week 0; no budgeted opex, no budgeted payroll.
    expect(result.periods[0]!.disbursements.operatingExpense).toBe(10_000);
    expect(result.periods[0]!.disbursements.payroll).toBe(0);
  });

  it("includes budgeted streams when the toggle is on", () => {
    const result = forecast({ ...input, includeBudgeted: true });
    expect(result.periods[0]!.disbursements.operatingExpense).toBe(15_000); // 10k + 5k
    // The budgeted monthly payroll now appears somewhere in the horizon.
    const totalPayroll = result.periods.reduce((s, p) => s + p.disbursements.payroll, 0);
    expect(totalPayroll).toBeGreaterThan(0);
  });
});

describe("bank totals / account inclusion", () => {
  it("splits operating vs excluded balances for the settings UI", () => {
    const result = forecast(
      base({
        bankAccounts: [
          { id: "chk", name: "Checking", beginningBalance: 300_000 },
          { id: "sav", name: "Savings", beginningBalance: 200_000 },
          { id: "hysa", name: "HYSA", beginningBalance: 150_000, operating: false },
        ],
      }),
    );
    expect(result.bankTotals.operating).toBe(500_000);
    expect(result.bankTotals.excluded).toBe(150_000);
    expect(result.bankTotals.total).toBe(650_000);
    expect(result.startingCash).toBe(result.bankTotals.operating);
    expect(result.totalBankBalance).toBe(result.bankTotals.total);
  });
});
