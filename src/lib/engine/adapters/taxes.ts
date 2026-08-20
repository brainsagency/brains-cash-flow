/**
 * Quarterly estimated taxes → dated cash out.
 *
 * Takes monthly operating profit (from the projections sheet) and a blended
 * rate, and produces the four IRS estimated-tax installments per year. Pure:
 * no I/O, no clock — every date is derived from the profit months themselves.
 *
 * The math is a **year-to-date true-up**, not four independent quarters:
 *
 *     liability(period) = max(0, YTD operating profit through period × rate)
 *     payment(period)   = max(0, liability − everything already scheduled this year)
 *
 * That matters because the business swings between profit and loss month to
 * month. A quarter-in-isolation model would bill tax on a good Q1 and give no
 * credit for a bad Q2; the YTD form lets a later loss shrink (or zero out) the
 * next payment, which is how estimated taxes actually work. The floor at zero
 * reflects that the IRS doesn't hand cash back mid-year — an overpayment just
 * suppresses later installments and settles at filing.
 */

import type { ISODate } from "../dates.js";
import type { CashEvent, TaxSettings } from "../types.js";
import { DEFAULT_TAX_RATE } from "../types.js";

/**
 * The four estimated-tax periods for a calendar-year filer. Note they are NOT
 * even quarters — the IRS periods are 3, 2, 3, and 4 months long. Using real
 * calendar quarters would date the June payment a month late.
 */
export interface EstimatedTaxPeriod {
  label: "Q1" | "Q2" | "Q3" | "Q4";
  /** First month covered (1-based). */
  fromMonth: number;
  /** Last month covered, inclusive (1-based). */
  throughMonth: number;
  /** Month the payment is due (1-based). */
  dueMonth: number;
  dueDay: number;
  /** Q4's payment is due in January of the FOLLOWING year. */
  dueYearOffset: 0 | 1;
}

export const ESTIMATED_TAX_PERIODS: readonly EstimatedTaxPeriod[] = [
  { label: "Q1", fromMonth: 1, throughMonth: 3, dueMonth: 4, dueDay: 15, dueYearOffset: 0 },
  { label: "Q2", fromMonth: 4, throughMonth: 5, dueMonth: 6, dueDay: 15, dueYearOffset: 0 },
  { label: "Q3", fromMonth: 6, throughMonth: 8, dueMonth: 9, dueDay: 15, dueYearOffset: 0 },
  { label: "Q4", fromMonth: 9, throughMonth: 12, dueMonth: 1, dueDay: 15, dueYearOffset: 1 },
];

/** One scheduled estimated-tax installment, with the working shown. */
export interface TaxInstallment {
  /** Stable id, e.g. "2026-Q3". Doubles as the CashEvent id. */
  id: string;
  year: number;
  label: EstimatedTaxPeriod["label"];
  /** Inclusive month range this period covers, e.g. "2026-06" … "2026-08". */
  fromMonth: string;
  throughMonth: string;
  /** Cumulative operating profit for the year through `throughMonth`. */
  ytdProfit: number;
  /** max(0, ytdProfit × rate) — total owed for the year so far. */
  ytdLiability: number;
  /** Sum of the installments scheduled earlier in the same year. */
  priorScheduled: number;
  /** What actually leaves the bank: max(0, ytdLiability − priorScheduled). */
  amount: number;
  dueDate: ISODate;
  /** True when `paidThrough` covers this due date (excluded from the forecast). */
  paid: boolean;
  /** Months in the year-to-date window with no profit figure, treated as 0. */
  missingMonths: string[];
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dueDateFor(year: number, period: EstimatedTaxPeriod): ISODate {
  const y = year + period.dueYearOffset;
  return `${y}-${String(period.dueMonth).padStart(2, "0")}-${String(period.dueDay).padStart(2, "0")}`;
}

/** The distinct calendar years present in a monthly-profit map, ascending. */
export function profitYears(monthlyProfit: Record<string, number>): number[] {
  const years = new Set<number>();
  for (const key of Object.keys(monthlyProfit)) {
    const year = Number(key.slice(0, 4));
    if (Number.isFinite(monthlyProfit[key]) && Number.isInteger(year)) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Build the full installment schedule — every period of every year that has at
 * least one month of profit data. Returns the schedule whether or not each
 * installment is payable, so the UI can show zeros and already-paid periods
 * (a $0 payment because losses wiped out the liability is information, not
 * nothing). Use `taxEvents` for the subset that actually moves cash.
 */
export function taxInstallments(settings: TaxSettings): TaxInstallment[] {
  const monthlyProfit = settings.monthlyProfit ?? {};
  const rate = Number.isFinite(settings.rate) ? settings.rate : DEFAULT_TAX_RATE;
  const out: TaxInstallment[] = [];

  for (const year of profitYears(monthlyProfit)) {
    let priorScheduled = 0;
    for (const period of ESTIMATED_TAX_PERIODS) {
      // YTD runs from January, not from the period start — that's what makes a
      // later loss claw back an earlier quarter's liability.
      let ytdProfit = 0;
      const missingMonths: string[] = [];
      for (let m = 1; m <= period.throughMonth; m++) {
        const key = monthKey(year, m);
        const value = monthlyProfit[key];
        if (typeof value === "number" && Number.isFinite(value)) ytdProfit += value;
        else missingMonths.push(key);
      }

      const ytdLiability = Math.max(0, Math.round(ytdProfit * rate));
      const amount = Math.max(0, ytdLiability - priorScheduled);
      const dueDate = dueDateFor(year, period);

      out.push({
        id: `${year}-${period.label}`,
        year,
        label: period.label,
        fromMonth: monthKey(year, period.fromMonth),
        throughMonth: monthKey(year, period.throughMonth),
        ytdProfit,
        ytdLiability,
        priorScheduled,
        amount,
        dueDate,
        paid: settings.paidThrough !== undefined && dueDate <= settings.paidThrough,
        missingMonths,
      });

      priorScheduled += amount;
    }
  }

  return out;
}

/**
 * The installments that actually move cash: skips $0 payments and anything
 * already paid. Emitted as `committed` basis — an estimated tax payment is
 * real cash leaving on a known date, even though the profit behind it is a
 * projection, so it belongs in the default forecast rather than behind the
 * `includeBudgeted` toggle.
 */
export function taxEvents(settings: TaxSettings | undefined): CashEvent[] {
  if (!settings?.enabled) return [];
  const ratePct = `${((settings.rate ?? DEFAULT_TAX_RATE) * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return taxInstallments(settings)
    .filter((i) => !i.paid && i.amount > 0)
    .map((i) => ({
      id: `tax:${i.id}`,
      category: "taxes" as const,
      amount: i.amount,
      date: i.dueDate,
      basis: "committed" as const,
      memo: `Estimated taxes ${i.label} ${i.year} — ${ratePct} of YTD operating profit`,
    }));
}
