import { describe, expect, it } from "vitest";
import {
  ESTIMATED_TAX_PERIODS,
  profitYears,
  taxEvents,
  taxInstallments,
  taxYearSummaries,
} from "./taxes.js";
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
    expect(q2.appliedBefore).toBe(50_771);
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
    expect(y2027Q1.appliedBefore).toBe(0);
    expect(y2027Q1.amount).toBe(35_000);
  });
});

describe("per-quarter liability", () => {
  const schedule = taxInstallments(base);

  it("reports what each period alone earned, separate from the running total", () => {
    // Q2 covers Apr–May only: 57,876 + 82,336.
    const q2 = schedule[1]!;
    expect(q2.quarterProfit).toBe(140_212);
    expect(q2.ytdProfit).toBe(285_272);
  });

  it("shows a loss-making quarter as reducing the year's liability", () => {
    // Q3 (Jun–Aug) loses 68,939 net, so it takes the running liability DOWN.
    const q3 = schedule[2]!;
    expect(q3.quarterProfit).toBe(-68_939);
    expect(q3.quarterLiability).toBeCloseTo(-24_128.65, 3);
    expect(q3.ytdLiability).toBe(75_716.55);
  });

  it("makes the quarter liabilities sum to the full-year figure", () => {
    const sum = schedule.reduce((s, i) => s + i.quarterLiability, 0);
    expect(sum).toBeCloseTo(schedule[3]!.ytdLiability, 3);
  });

  it("closes each period on the last day of its final month", () => {
    expect(schedule.map((i) => i.periodEnd)).toEqual([
      "2026-03-31",
      "2026-05-31",
      "2026-08-31",
      "2026-12-31",
    ]);
  });
});

describe("recorded payments", () => {
  it("credits an actual payment so the next quarter trues up against it", () => {
    // Paid only 30,000 in April against a 50,771.19 liability.
    const short = taxInstallments({
      ...base,
      payments: { "2026-Q1": { amount: 30_000, paid: true } },
    });
    expect(short[0]!.amount).toBe(30_000);
    expect(short[0]!.balance).toBeCloseTo(20_771, 3); // still owed after Q1
    // June must now cover the shortfall as well as its own increment.
    expect(short[1]!.appliedBefore).toBe(30_000);
    expect(short[1]!.scheduledAmount).toBeCloseTo(69_845.2, 3);
    expect(short[1]!.amount).toBeCloseTo(69_845.2, 3);
  });

  it("lowers the next quarter when you overpay", () => {
    const over = taxInstallments({
      ...base,
      payments: { "2026-Q1": { amount: 90_000, paid: true } },
    });
    expect(over[0]!.balance).toBeCloseTo(-39_229, 3); // overpaid
    expect(over[1]!.amount).toBeCloseTo(9_845.2, 3); // 99,845.20 − 90,000
  });

  it("never asks for a negative payment, however large the overpayment", () => {
    const huge = taxInstallments({
      ...base,
      payments: { "2026-Q1": { amount: 500_000, paid: true } },
    });
    expect(huge.slice(1).every((i) => i.amount === 0)).toBe(true);
    expect(huge[3]!.balance).toBeCloseTo(-484_010.6, 3);
  });

  it("treats an unpaid entry as a planned override that still costs cash", () => {
    const planned = taxInstallments({
      ...base,
      payments: { "2026-Q2": { amount: 40_000, paid: false, date: "2026-07-01" } },
    });
    const q2 = planned[1]!;
    expect(q2.overridden).toBe(true);
    expect(q2.paid).toBe(false);
    expect(q2.amount).toBe(40_000);
    expect(q2.date).toBe("2026-07-01");
    const events = taxEvents({
      ...base,
      payments: { "2026-Q2": { amount: 40_000, paid: false, date: "2026-07-01" } },
    });
    expect(events.find((e) => e.id === "tax:2026-Q2")).toMatchObject({
      amount: 40_000,
      date: "2026-07-01",
    });
  });

  it("keeps a paid installment out of the forecast", () => {
    const events = taxEvents({
      ...base,
      payments: { "2026-Q1": { amount: 50_771, paid: true } },
    });
    expect(events.map((e) => e.id)).toEqual(["tax:2026-Q2"]);
  });

  it("lets a per-quarter entry override the blunt paidThrough cutoff", () => {
    // paidThrough would mark Q1 paid; the explicit entry says otherwise.
    const schedule = taxInstallments({
      ...base,
      paidThrough: "2026-12-31",
      payments: { "2026-Q1": { amount: 50_771, paid: false } },
    });
    expect(schedule[0]!.paid).toBe(false);
    expect(schedule[1]!.paid).toBe(true); // still covered by the cutoff
  });

  it("carries the note through to the ledger memo", () => {
    const events = taxEvents({
      ...base,
      payments: { "2026-Q2": { amount: 1_000, note: "per Upsourced voucher" } },
    });
    expect(events.find((e) => e.id === "tax:2026-Q2")!.memo).toContain("per Upsourced voucher");
  });
});

describe("year summary", () => {
  it("accrues through the last COMPLETE MONTH, not the last closed quarter", () => {
    // 20 Aug: quarter-based accrual would report through 31 May and overstate.
    const [s] = taxYearSummaries(base, "2026-08-20");
    expect(s!.accruedThroughMonth).toBe("2026-07");
    // Jan–Jul profit = 177,286 → ×0.35
    expect(s!.liabilityAccrued).toBeCloseTo(62_050.1, 2);
  });

  it("moves on as each month completes", () => {
    expect(taxYearSummaries(base, "2026-08-31")[0]!.accruedThroughMonth).toBe("2026-08");
    expect(taxYearSummaries(base, "2026-09-01")[0]!.accruedThroughMonth).toBe("2026-08");
  });

  it("never reports a negative accrual in a loss-making year", () => {
    const losses: TaxSettings = {
      enabled: true,
      rate: 0.35,
      monthlyProfit: { "2026-01": -50_000, "2026-02": -50_000 },
    };
    expect(taxYearSummaries(losses, "2026-06-01")[0]!.liabilityAccrued).toBe(0);
  });

  it("splits paid from still-to-fund", () => {
    const [s] = taxYearSummaries(
      { ...base, payments: { "2026-Q1": { amount: 50_771, paid: true } } },
      "2026-08-20",
    );
    expect(s!.paidToDate).toBe(50_771);
    expect(s!.scheduledAhead).toBeCloseTo(49_074.2, 3);
  });

  it("flags how far paying the schedule would overshoot the year", () => {
    // Skip Q1 and Q2 entirely: the Q3 catch-up is sized on profit through Aug,
    // but the year finishes far lower, so paying it overshoots.
    const skipped: TaxSettings = {
      ...base,
      payments: {
        "2026-Q1": { amount: 0, paid: false },
        "2026-Q2": { amount: 0, paid: false },
      },
    };
    const [s] = taxYearSummaries(skipped, "2026-08-20");
    expect(s!.scheduledAhead).toBe(75_716.55); // the Q3 catch-up
    expect(s!.liabilityFullYear).toBe(15_989.4);
    expect(s!.overpaymentIfPaidAsScheduled).toBeCloseTo(59_727.15, 2);
  });

  it("reports no overshoot when the schedule matches the year", () => {
    const [s] = taxYearSummaries(
      { ...base, monthlyProfit: { "2026-01": 30_000, "2026-02": 30_000, "2026-03": 30_000 } },
      "2026-01-01",
    );
    expect(s!.overpaymentIfPaidAsScheduled).toBe(0);
  });

  it("points at the next installment that actually moves cash", () => {
    const [s] = taxYearSummaries(base, "2026-05-01");
    expect(s!.next).toMatchObject({ id: "2026-Q2", date: "2026-06-15" });
    // Q1 is in the past, and Q3/Q4 are $0, so after June there is nothing left.
    expect(taxYearSummaries(base, "2026-07-01")[0]!.next).toBeNull();
  });

  it("summarises each year separately", () => {
    const two: TaxSettings = {
      ...base,
      monthlyProfit: { ...PROFIT_2026, "2027-01": 100_000 },
    };
    expect(taxYearSummaries(two, "2026-08-20").map((s) => s.year)).toEqual([2026, 2027]);
  });
});
