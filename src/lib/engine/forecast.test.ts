import { describe, expect, it } from "vitest";
import { forecast } from "./forecast.js";
import type { BankAccount, ForecastInput } from "./types.js";

const ANCHOR = "2026-07-06";

function account(beginningBalance: number): BankAccount {
  return { id: "op", name: "Operating", beginningBalance };
}

function base(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    anchorDate: ANCHOR,
    bankAccounts: [account(100_000)],
    ...overrides,
  };
}

describe("forecast — balances", () => {
  it("rolls beginning → received → spent → ending across periods", () => {
    const result = forecast(
      base({
        events: [
          { category: "currentAR", amount: 50_000, date: "2026-07-08" }, // week 0
          { category: "payroll", amount: 30_000, date: "2026-07-15" }, // week 1
        ],
      }),
    );

    expect(result.startingCash).toBe(100_000);
    const w0 = result.periods[0]!;
    expect(w0.totalReceipts).toBe(50_000);
    expect(w0.receipts.currentAR).toBe(50_000);
    expect(w0.endingBalance).toBe(150_000);

    const w1 = result.periods[1]!;
    expect(w1.beginningBalance).toBe(150_000);
    expect(w1.disbursements.payroll).toBe(30_000);
    expect(w1.endingBalance).toBe(120_000);
  });

  it("sums operating accounts into starting cash", () => {
    const result = forecast(
      base({
        bankAccounts: [
          { id: "chk", name: "Checking", beginningBalance: 60_000 },
          { id: "sav", name: "Savings", beginningBalance: 40_000 },
        ],
      }),
    );
    expect(result.startingCash).toBe(100_000);
    expect(result.periods[0]!.beginningBalance).toBe(100_000);
  });

  it("excludes non-operating (reserve) accounts from operating cash but not the total", () => {
    const result = forecast(
      base({
        bankAccounts: [
          { id: "chk", name: "Checking …0377", beginningBalance: 380_000 },
          { id: "sav", name: "Savings …1535", beginningBalance: 250_000 },
          { id: "shr", name: "Shareholder …8987", beginningBalance: 90_000, operating: false },
          { id: "prod", name: "Production", beginningBalance: 685_000, operating: false },
        ],
      }),
    );
    expect(result.startingCash).toBe(630_000); // checking + savings only
    expect(result.totalBankBalance).toBe(1_405_000); // all four
  });

  it("ignores events outside the horizon", () => {
    const result = forecast(
      base({ events: [{ category: "currentAR", amount: 999_999, date: "2035-01-01" }] }),
    );
    const totalReceived = result.periods.reduce((s, p) => s + p.totalReceipts, 0);
    expect(totalReceived).toBe(0);
  });
});

describe("forecast — pipeline toggle & weighting", () => {
  const withDeal = base({
    pipeline: [
      {
        id: "d1",
        name: "Big Co",
        value: 100_000,
        probability: 0.5,
        expectedCloseDate: "2026-07-20",
        collectionLagDays: 30,
      },
    ],
  });

  it("excludes pipeline when toggle is off", () => {
    const result = forecast({ ...withDeal, includePipeline: false });
    const pipelineTotal = result.periods.reduce((s, p) => s + p.receipts.pipeline, 0);
    expect(pipelineTotal).toBe(0);
  });

  it("includes probability-weighted pipeline when toggle is on", () => {
    const result = forecast({ ...withDeal, includePipeline: true });
    const pipelineTotal = result.periods.reduce((s, p) => s + p.receipts.pipeline, 0);
    expect(pipelineTotal).toBeCloseTo(50_000, 5); // 100k × 0.5
  });
});

describe("forecast — burn, reserve, runway", () => {
  const result = forecast(
    base({
      recurring: [
        {
          category: "operatingExpense",
          amount: 30_000,
          frequency: "monthly",
          startDate: ANCHOR,
        },
      ],
    }),
  );

  it("computes a steady monthly burn near the recurring outflow", () => {
    expect(result.monthlyBurn).toBeGreaterThan(29_000);
    expect(result.monthlyBurn).toBeLessThan(32_000);
  });

  it("sets reserve target to multiple × burn", () => {
    expect(result.reserveTarget).toBeCloseTo(result.settings.reserveMultiple * result.monthlyBurn, 5);
  });

  it("computes a plausible runway", () => {
    expect(result.runwayMonthsSimple).not.toBeNull();
    expect(result.runwayMonthsSimple!).toBeGreaterThan(3);
    expect(result.runwayMonthsSimple!).toBeLessThan(4);
    expect(result.runwayMonths).not.toBeNull();
  });

  it("reports null runway when cash never goes negative", () => {
    const flush = forecast(base({ bankAccounts: [account(10_000_000)] }));
    expect(flush.runwayMonths).toBeNull();
  });

  it("uses a hard-keyed burn override (the sheet's $440k) when provided", () => {
    const overridden = forecast(
      base({
        settings: {
          reserveMultiple: 3,
          runwayAlertMonths: 6,
          largeOverdueARThreshold: 50_000,
          monthlyBurnOverride: 440_000,
        },
        recurring: [
          { category: "operatingExpense", amount: 30_000, frequency: "monthly", startDate: ANCHOR },
        ],
      }),
    );
    expect(overridden.monthlyBurn).toBe(440_000);
    expect(overridden.reserveTarget).toBe(1_320_000); // 3 × 440k
    // The derived figure is still computed for comparison and differs.
    expect(overridden.monthlyBurnComputed).toBeGreaterThan(0);
    expect(overridden.monthlyBurnComputed).not.toBe(440_000);
  });

  it("computes per-period reserve excess/shortfall", () => {
    const result = forecast(
      base({
        bankAccounts: [account(100_000)],
        settings: {
          reserveMultiple: 3,
          runwayAlertMonths: 6,
          largeOverdueARThreshold: 50_000,
          monthlyBurnOverride: 20_000,
        },
      }),
    );
    // Reserve target = 60k; with flat 100k cash and no flows, excess = 40k.
    expect(result.reserveTarget).toBe(60_000);
    expect(result.periods[0]!.reserveExcess).toBe(40_000);
  });
});

describe("forecast — alerts", () => {
  it("fires the sheet rule: ending < 0 while overdue AR is outstanding", () => {
    const result = forecast(
      base({
        bankAccounts: [account(10_000)],
        events: [
          { category: "payroll", amount: 60_000, date: "2026-07-15" }, // → negative
          { category: "overdueAR", amount: 20_000, date: "2026-09-01" }, // outstanding
        ],
      }),
    );
    const alert = result.alerts.find((a) => a.type === "negativeBalanceWithOverdueAR");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("critical");
  });

  it("flags a large overdue AR balance over the threshold", () => {
    const result = forecast(
      base({
        settings: { reserveMultiple: 3, runwayAlertMonths: 6, largeOverdueARThreshold: 50_000 },
        events: [{ category: "overdueAR", amount: 75_000, date: "2026-08-01", memo: "Acme" }],
      }),
    );
    const alert = result.alerts.find((a) => a.type === "largeOverdueAR");
    expect(alert).toBeDefined();
    expect(alert!.message).toContain("Acme");
  });

  it("flags low runway below the configured threshold", () => {
    const result = forecast(
      base({
        bankAccounts: [account(20_000)],
        recurring: [
          { category: "operatingExpense", amount: 30_000, frequency: "monthly", startDate: ANCHOR },
        ],
      }),
    );
    expect(result.alerts.some((a) => a.type === "lowRunway")).toBe(true);
  });
});
