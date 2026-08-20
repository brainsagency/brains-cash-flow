import { describe, expect, it } from "vitest";
import { forecast, taxEvents, type ForecastInput, type TaxSettings } from "./index.js";

/**
 * End-to-end: a tax installment has to survive the whole pipeline — event →
 * period bucket → `taxes` disbursement line → ending balance. The unit tests
 * prove the schedule is right; this proves the forecast actually spends it.
 */

const TAXES: TaxSettings = {
  enabled: true,
  rate: 0.35,
  monthlyProfit: {
    "2026-01": 100_000,
    "2026-02": 100_000,
    "2026-03": 100_000,
  },
};

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    anchorDate: "2026-04-01",
    bankAccounts: [{ id: "chk", name: "Checking", beginningBalance: 1_000_000 }],
    horizon: { weeklyPeriods: 0, monthlyPeriods: 12 },
    ...overrides,
  };
}

describe("taxes in the forecast", () => {
  it("shows up on its own disbursement line, not lumped into other withdrawals", () => {
    const events = taxEvents(TAXES);
    const result = forecast(baseInput({ events }));
    const april = result.periods.find((p) => p.period.start.startsWith("2026-04"))!;

    expect(april.disbursements.taxes).toBe(105_000); // 300k × 35%
    expect(april.disbursements.otherWithdrawals).toBe(0);
  });

  it("reduces the ending balance by the payment", () => {
    const withTax = forecast(baseInput({ events: taxEvents(TAXES) }));
    const without = forecast(baseInput({ events: [] }));
    const last = (r: typeof withTax) => r.periods[r.periods.length - 1]!.endingBalance;
    expect(last(without) - last(withTax)).toBe(105_000);
  });

  it("lands in the period holding April 15, not the quarter start", () => {
    const result = forecast(baseInput({ events: taxEvents(TAXES) }));
    const spending = result.periods.filter((p) => p.disbursements.taxes > 0);
    expect(spending).toHaveLength(1);
    expect(spending[0]!.period.start).toBe("2026-04-01");
    expect(spending[0]!.period.end >= "2026-04-15").toBe(true);
  });

  it("counts toward burn and can pull runway in", () => {
    const drain = baseInput({
      bankAccounts: [{ id: "chk", name: "Checking", beginningBalance: 120_000 }],
      events: taxEvents(TAXES),
    });
    const result = forecast(drain);
    // 120k − 105k leaves the account nearly empty but still positive.
    expect(result.periods[0]!.endingBalance).toBe(15_000);
    expect(result.monthlyBurn).toBeGreaterThan(0);
  });

  it("contributes nothing when taxes are disabled", () => {
    const result = forecast(baseInput({ events: taxEvents({ ...TAXES, enabled: false }) }));
    expect(result.periods.every((p) => p.disbursements.taxes === 0)).toBe(true);
  });

  it("stays in the forecast under the committed-only default", () => {
    // Tax payments are real cash, so they must NOT hide behind includeBudgeted
    // the way the model's budgeted salaries do.
    const result = forecast(baseInput({ events: taxEvents(TAXES), includeBudgeted: false }));
    expect(result.periods[0]!.disbursements.taxes).toBe(105_000);
  });
});
