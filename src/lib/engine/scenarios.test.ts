import { describe, expect, it } from "vitest";
import { forecast } from "./forecast.js";
import {
  applyScenario,
  compareScenarios,
  forkScenario,
  runScenario,
  type Scenario,
} from "./scenarios.js";
import type { ForecastInput, ForecastResult } from "./types.js";

const ANCHOR = "2026-07-06";

function base(): ForecastInput {
  return {
    anchorDate: ANCHOR,
    bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 500_000 }],
    recurring: [
      { id: "payroll-base", category: "payroll", amount: 50_000, frequency: "monthly", startDate: ANCHOR },
      { id: "retainer-A", category: "currentAR", amount: 60_000, frequency: "monthly", startDate: ANCHOR },
    ],
    pipeline: [
      {
        id: "d1",
        name: "Big Co",
        value: 200_000,
        probability: 0.5,
        expectedCloseDate: "2026-08-01",
        collectionLagDays: 30,
      },
    ],
    includePipeline: true,
  };
}

const finalEnding = (r: ForecastResult): number => r.periods.at(-1)!.endingBalance;

const empty = (name: string): Scenario => ({ id: name, name, levers: [] });

describe("scenario levers", () => {
  const baseline = forecast(base());

  it("hire lowers ending cash by roughly the added comp", () => {
    const scenario: Scenario = {
      id: "s",
      name: "Add engineer",
      levers: [{ kind: "hire", role: "Engineer", annualComp: 240_000, startDate: "2026-08-01" }],
    };
    const result = runScenario(base(), scenario);
    expect(finalEnding(result)).toBeLessThan(finalEnding(baseline));
  });

  it("hire ramp costs less than a full-price hire over the ramp window", () => {
    const full = runScenario(base(), {
      id: "full",
      name: "full",
      levers: [{ kind: "hire", role: "R", annualComp: 240_000, startDate: "2026-08-01" }],
    });
    const ramped = runScenario(base(), {
      id: "ramp",
      name: "ramp",
      levers: [
        {
          kind: "hire",
          role: "R",
          annualComp: 240_000,
          startDate: "2026-08-01",
          rampMonths: 3,
          rampStartPct: 50,
        },
      ],
    });
    // Ramp defers cost, so ending cash is higher than the full-price hire.
    expect(finalEnding(ramped)).toBeGreaterThan(finalEnding(full));
  });

  it("layoff raises ending cash net of severance", () => {
    const result = runScenario(base(), {
      id: "s",
      name: "RIF",
      levers: [
        { kind: "layoff", role: "Analyst", monthlySalary: 20_000, effectiveDate: "2026-09-01", severance: 40_000 },
      ],
    });
    expect(finalEnding(result)).toBeGreaterThan(finalEnding(baseline));
  });

  it("churn by recurring id truncates the retainer", () => {
    const result = runScenario(base(), {
      id: "s",
      name: "Lose retainer A",
      levers: [
        { kind: "churn", client: "A", monthlyAmount: 60_000, effectiveDate: "2026-10-01", recurringId: "retainer-A" },
      ],
    });
    expect(finalEnding(result)).toBeLessThan(finalEnding(baseline));
  });

  it("pipeline sensitivity with 0 multiplier removes weighted pipeline revenue", () => {
    const result = runScenario(base(), {
      id: "s",
      name: "No wins",
      levers: [{ kind: "pipelineSensitivity", winRateMultiplier: 0 }],
    });
    const pipelineTotal = result.periods.reduce((s, p) => s + p.receipts.pipeline, 0);
    expect(pipelineTotal).toBe(0);
    expect(finalEnding(result)).toBeLessThan(finalEnding(baseline));
  });

  it("collection timing shifts overdue AR to a later period", () => {
    const input: ForecastInput = {
      ...base(),
      events: [{ category: "overdueAR", amount: 30_000, date: "2026-07-08" }], // week 0
    };
    const slowed = runScenario(input, {
      id: "s",
      name: "Slow collections",
      levers: [{ kind: "collectionTiming", overdueShiftDays: 21 }],
    });
    // The overdue receipt is no longer in week 0.
    expect(slowed.periods[0]!.receipts.overdueAR).toBe(0);
    const total = slowed.periods.reduce((s, p) => s + p.receipts.overdueAR, 0);
    expect(total).toBeCloseTo(30_000, 5);
  });

  it("does not mutate the base input", () => {
    const input = base();
    const before = JSON.stringify(input);
    applyScenario(input, {
      id: "s",
      name: "x",
      levers: [{ kind: "hire", role: "R", annualComp: 120_000, startDate: "2026-08-01" }],
    });
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("fork & compare", () => {
  it("forks a scenario appending levers without touching the source", () => {
    const source: Scenario = {
      id: "base",
      name: "Base plan",
      levers: [{ kind: "hire", role: "PM", annualComp: 180_000, startDate: "2026-08-01" }],
    };
    const forked = forkScenario(source, {
      id: "aggressive",
      name: "Aggressive",
      addLevers: [{ kind: "hire", role: "Eng", annualComp: 200_000, startDate: "2026-09-01" }],
    });
    expect(source.levers).toHaveLength(1);
    expect(forked.levers).toHaveLength(2);
    expect(forked.id).toBe("aggressive");
  });

  it("compares two scenarios period-by-period", () => {
    const baseline = runScenario(base(), empty("baseline"));
    const withHire = runScenario(base(), {
      id: "hire",
      name: "hire",
      levers: [{ kind: "hire", role: "Eng", annualComp: 240_000, startDate: "2026-08-01" }],
    });
    const cmp = compareScenarios(baseline, withHire);
    expect(cmp.periods).toHaveLength(baseline.periods.length);
    expect(cmp.finalEndingDelta).toBeLessThan(0); // hiring costs money
    expect(cmp.finalEndingDelta).toBeCloseTo(finalEnding(withHire) - finalEnding(baseline), 5);
  });
});
