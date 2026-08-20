import { describe, expect, it } from "vitest";
import { ESTIMATED_TAX_PERIODS, profitYears, taxEvents, taxInstallments } from "./taxes.js";
import type { TaxSettings } from "../types.js";

/**
 * Real "Projected Operating Profit" figures from the Brains Projections 2026
 * Summary block (read 2026-08-20). Keeping the actual numbers here means the
 * tests fail loudly if the true-up math ever stops matching the business case
 * it was built for.
 */
const PROFIT_2026: Record<string, number> = {
  "2026-01": -21_564,
  "2026-02": 14_798,
  "2026-03": 151_826,
  "2026-04": 57_876,
  "2026-05": 82_336,
  "2026-06": -71_621,
  "2026-07": -36_365,
  "2026-08": 39_047,
  "2026-09": 28_168,
  "2026-10": -34_803,
  "2026-11": -21_332,
  "2026-12": -142_682,
};

const base: TaxSettings = { enabled: true, rate: 0.35, monthlyProfit: PROFIT_2026 };

describe("estimated tax periods", () => {
  it("uses the IRS periods, which are not even quarters", () => {
    expect(ESTIMATED_TAX_PERIODS.map((p) => [p.fromMonth, p.throughMonth])).toEqual([
      [1, 3],
      [4, 5],
      [6, 8],
      [9, 12],
    ]);
  });

  it("dates Q4 in January of the following year", () => {
    const q4 = taxInstallments(base).find((i) => i.label === "Q4")!;
    expect(q4.dueDate).toBe("2027-01-15");
  });

  it("dates Q1–Q3 on the 15th of April, June, and September", () => {
    const dates = taxInstallments(base).map((i) => i.dueDate);
    expect(dates).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  });
});

describe("YTD true-up", () => {
  const schedule = taxInstallments(base);

  it("taxes cumulative profit, not the period in isolation", () => {
    const q1 = schedule[0]!;
    // Jan + Feb + Mar = -21,564 + 14,798 + 151,826
    expect(q1.ytdProfit).toBe(145_060);
    expect(q1.ytdLiability).toBe(Math.round(145_060 * 0.35)); // 50,771
    expect(q1.amount).toBe(50_771);
  });

  it("credits the prior payment so each installment is only the increment", () => {
    const q2 = schedule[1]!;
    // YTD through May = 285,272 → liability 99,845.20; Q1 already covered 50,771.
    expect(q2.ytdProfit).toBe(285_272);
    expect(q2.ytdLiability).toBe(99_845.2);
    expect(q2.priorScheduled).toBe(50_771);
    expect(q2.amount).toBe(49_074.2);
  });

  it("lets a mid-year loss shrink the next payment", () => {
    const q3 = schedule[2]!;
    // Jun/Jul lose 107,986 against Aug's 39,047 → YTD falls to 216,333.
    expect(q3.ytdProfit).toBe(216_333);
    expect(q3.ytdLiability).toBe(75_716.55);
    // Already scheduled 99,845.20 > 75,716.55, so nothing is owed in September.
    expect(q3.amount).toBe(0);
  });

  it("never goes negative when the year turns to a loss", () => {
    const q4 = schedule[3]!;
    // Full-year operating profit — ties to the sheet's $45,685 annual total
    // (the dollar of drift is the sheet rounding each month for display).
    expect(q4.ytdProfit).toBe(45_684);
    expect(q4.ytdLiability).toBe(15_989.4);
    expect(q4.amount).toBe(0); // 99,845.20 already paid — no refund mid-year
  });

  it("totals the year's payments at the high-water liability, not the year-end one", () => {
    const total = schedule.reduce((s, i) => s + i.amount, 0);
    expect(total).toBeCloseTo(99_845.2, 3); // peaked at May's YTD; later losses don't refund
  });
});

describe("precision", () => {
  it("carries money to a tenth of a cent rather than whole dollars", () => {
    // The sheet's real figures are unrounded floats; whole-dollar rounding
    // threw away precision and stopped the totals tying back to the source.
    const unrounded: TaxSettings = {
      enabled: true,
      rate: 0.35,
      monthlyProfit: { "2026-01": 1_000.005, "2026-02": 2_000.004, "2026-03": 3_000.006 },
    };
    const [q1] = taxInstallments(unrounded);
    expect(q1!.ytdProfit).toBe(6_000.015);
    expect(q1!.ytdLiability).toBe(2_100.005);
  });

  it("does not leak binary float noise into the figures", () => {
    const noisy: TaxSettings = {
      enabled: true,
      rate: 0.35,
      monthlyProfit: { "2026-01": -21_563.570000000065, "2026-02": 14_798.070000000007 },
    };
    const [q1] = taxInstallments(noisy);
    expect(q1!.ytdProfit).toBe(-6_765.5); // not -6765.500000000058
    expect(q1!.amount).toBe(0);
  });
});

describe("a straightforwardly profitable year", () => {
  const steady: TaxSettings = {
    enabled: true,
    rate: 0.3,
    monthlyProfit: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`2027-${String(i + 1).padStart(2, "0")}`, 10_000]),
    ),
  };

  it("spreads payments in proportion to the months each period covers", () => {
    const amounts = taxInstallments(steady).map((i) => i.amount);
    // 3, 2, 3, and 4 months at 10k × 30% = 3k/month.
    expect(amounts).toEqual([9_000, 6_000, 9_000, 12_000]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(36_000); // 120k × 30%
  });
});

describe("paidThrough", () => {
  it("drops installments whose due date has already passed", () => {
    const events = taxEvents({ ...base, paidThrough: "2026-06-30" });
    expect(events).toHaveLength(0); // Q1/Q2 paid, Q3/Q4 are $0
  });

  it("marks them paid on the schedule so the UI can still show them", () => {
    const schedule = taxInstallments({ ...base, paidThrough: "2026-06-30" });
    expect(schedule.map((i) => i.paid)).toEqual([true, true, false, false]);
  });

  it("keeps installments due after the cutoff", () => {
    const events = taxEvents({ ...base, paidThrough: "2026-05-01" });
    expect(events.map((e) => e.date)).toEqual(["2026-06-15"]);
  });
});

describe("taxEvents", () => {
  it("emits nothing when disabled", () => {
    expect(taxEvents({ ...base, enabled: false })).toEqual([]);
    expect(taxEvents(undefined)).toEqual([]);
  });

  it("emits committed-basis taxes disbursements with stable ids", () => {
    const events = taxEvents(base);
    expect(events).toHaveLength(2); // Q3 and Q4 are $0
    expect(events[0]).toMatchObject({
      id: "tax:2026-Q1",
      category: "taxes",
      amount: 50_771,
      date: "2026-04-15",
      basis: "committed",
    });
    expect(events[0]!.memo).toContain("35%");
  });

  it("skips $0 installments rather than cluttering the ledger", () => {
    expect(taxEvents(base).map((e) => e.id)).toEqual(["tax:2026-Q1", "tax:2026-Q2"]);
  });
});

describe("incomplete data", () => {
  it("treats missing months as zero and reports them", () => {
    const partial: TaxSettings = {
      enabled: true,
      rate: 0.35,
      monthlyProfit: { "2026-01": 30_000, "2026-02": 30_000 },
    };
    const [q1] = taxInstallments(partial);
    expect(q1!.ytdProfit).toBe(60_000);
    expect(q1!.missingMonths).toEqual(["2026-03"]);
    expect(q1!.amount).toBe(21_000);
  });

  it("produces no schedule at all with no profit data", () => {
    expect(taxInstallments({ enabled: true, rate: 0.35 })).toEqual([]);
    expect(taxInstallments({ enabled: true, rate: 0.35, monthlyProfit: {} })).toEqual([]);
  });

  it("handles multiple years independently", () => {
    const twoYears: TaxSettings = {
      enabled: true,
      rate: 0.35,
      monthlyProfit: { ...PROFIT_2026, "2027-01": 100_000 },
    };
    expect(profitYears(twoYears.monthlyProfit!)).toEqual([2026, 2027]);
    const schedule = taxInstallments(twoYears);
    expect(schedule).toHaveLength(8);
    // 2027 restarts from zero — 2026's overpayment does not carry across.
    const y2027Q1 = schedule.find((i) => i.id === "2027-Q1")!;
    expect(y2027Q1.priorScheduled).toBe(0);
    expect(y2027Q1.amount).toBe(35_000);
  });
});
