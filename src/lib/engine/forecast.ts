/**
 * The forecasting engine core.
 *
 * Pure function: `forecast(input) -> ForecastResult`. No I/O, no clock, no
 * randomness. Given the same input it always returns the same output, which is
 * what lets us unit-test it against the sheet and trust the runway number.
 *
 * Pipeline: normalize inputs → dated events → bucket into periods → roll
 * balances forward → derive burn / reserve / runway → raise alerts.
 */

import { AVG_DAYS_PER_MONTH, daysBetween, monthsBetween, type ISODate } from "./dates.js";
import { expandRecurring, pipelineToEvents } from "./events.js";
import { buildPeriods, periodIndexForDate } from "./periods.js";
import {
  DEFAULT_HORIZON,
  DEFAULT_SETTINGS,
  DISBURSEMENT_CATEGORIES,
  RECEIPT_CATEGORIES,
  directionOf,
  type Accrual,
  type AccrualBalance,
  type Alert,
  type CashBasis,
  type CashEvent,
  type DisbursementBreakdown,
  type ForecastInput,
  type ForecastResult,
  type Period,
  type PeriodForecast,
  type ReceiptBreakdown,
} from "./types.js";

function emptyReceipts(): ReceiptBreakdown {
  return { currentAR: 0, overdueAR: 0, notInvoiced: 0, pipeline: 0, locDraw: 0 };
}

function emptyDisbursements(): DisbursementBreakdown {
  return {
    payroll: 0,
    operatingExpense: 0,
    amex: 0,
    otherWithdrawals: 0,
    accountsPayable: 0,
    apEstimate: 0,
    bonusAccruals: 0,
  };
}

/** The effective (probability-weighted) magnitude of a cash event. */
export function weightedAmount(e: CashEvent): number {
  const p = e.probability ?? 1;
  return e.amount * p;
}

function isIncludedBasis(basis: CashBasis | undefined, includeBudgeted: boolean): boolean {
  // Undefined defaults to committed, which is always included.
  return includeBudgeted || (basis ?? "committed") === "committed";
}

/**
 * Collect every dated cash event the forecast should consider: explicit
 * events, expanded recurring items, and (if toggled on) pipeline deals.
 *
 * `budgeted`-basis streams are dropped unless `includeBudgeted` is on, so the
 * financial model's plan never silently inflates/deflates committed cash.
 */
export function collectEvents(input: ForecastInput, horizonEnd: ISODate): CashEvent[] {
  const includeBudgeted = input.includeBudgeted ?? false;
  const events: CashEvent[] = [];

  for (const e of input.events ?? []) {
    if (isIncludedBasis(e.basis, includeBudgeted)) events.push(e);
  }

  for (const item of input.recurring ?? []) {
    if (!isIncludedBasis(item.basis, includeBudgeted)) continue;
    // Expanded events inherit the item's basis so downstream filters agree.
    for (const ev of expandRecurring(item, horizonEnd)) {
      events.push(item.basis !== undefined ? { ...ev, basis: item.basis } : ev);
    }
  }

  // A deal counts when it's explicitly enabled; unset deals fall back to the
  // global pipeline toggle (legacy behavior). This lets the UI flip individual
  // opportunities on/off independent of the global switch.
  for (const deal of input.pipeline ?? []) {
    if (!(deal.enabled ?? input.includePipeline ?? false)) continue;
    // pipelineToEvents skips installments/deals with an incomplete date, so a
    // deal mid-edit never feeds a malformed date to the period math.
    events.push(...pipelineToEvents(deal));
  }

  return events;
}

export function forecast(input: ForecastInput): ForecastResult {
  const horizon = input.horizon ?? DEFAULT_HORIZON;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const periods = buildPeriods(input.anchorDate, horizon);
  if (periods.length === 0) {
    throw new Error("Horizon produced zero periods; set weeklyPeriods/monthlyPeriods > 0.");
  }
  const horizonEnd = periods[periods.length - 1]!.end;

  const accounts = input.bankAccounts ?? [];
  // Operating cash (what the forecast rolls forward) excludes reserve accounts
  // like HYSA / Shareholder / Production — matches Cash Flow row 35 (D29+D30).
  const startingCash = accounts
    .filter((a) => a.operating !== false)
    .reduce((s, a) => s + a.beginningBalance, 0);
  const excludedBalance = accounts
    .filter((a) => a.operating === false)
    .reduce((s, a) => s + a.beginningBalance, 0);
  const totalBankBalance = startingCash + excludedBalance;

  const events = collectEvents(input, horizonEnd);

  // Bucket events into periods.
  const receiptsByPeriod = periods.map(emptyReceipts);
  const disbursementsByPeriod = periods.map(emptyDisbursements);

  for (const e of events) {
    const idx = periodIndexForDate(periods, e.date);
    if (idx === -1) continue; // outside the horizon — ignored
    const amt = weightedAmount(e);
    if (directionOf(e.category) === "in") {
      const r = receiptsByPeriod[idx]!;
      r[e.category as keyof ReceiptBreakdown] += amt;
    } else {
      const d = disbursementsByPeriod[idx]!;
      d[e.category as keyof DisbursementBreakdown] += amt;
    }
  }

  // Roll balances forward and track accruals.
  const accrualState = (input.accruals ?? []).map((a) => ({ def: a, balance: a.beginningBalance }));
  const periodForecasts: PeriodForecast[] = [];
  let runningBalance = startingCash;

  for (const period of periods) {
    const receipts = receiptsByPeriod[period.index]!;
    const disbursements = disbursementsByPeriod[period.index]!;
    const totalReceipts = sum(Object.values(receipts));
    const totalDisbursements = sum(Object.values(disbursements));
    const netFlow = totalReceipts - totalDisbursements;
    const beginningBalance = runningBalance;
    const endingBalance = beginningBalance + netFlow;
    runningBalance = endingBalance;

    const accruals = advanceAccruals(accrualState, period);

    periodForecasts.push({
      period,
      beginningBalance,
      receipts,
      totalReceipts,
      disbursements,
      totalDisbursements,
      netFlow,
      endingBalance,
      reserveExcess: 0, // backfilled below once the reserve target is known
      accruals,
    });
  }

  const monthlyBurnComputed = computeMonthlyBurn(
    periodForecasts,
    input.anchorDate,
    settings.burnWindowMonths,
  );
  const monthlyBurn = settings.monthlyBurnOverride ?? monthlyBurnComputed;
  const reserveTarget = settings.reserveMultiple * monthlyBurn;
  for (const p of periodForecasts) {
    p.reserveExcess = p.endingBalance - reserveTarget;
  }
  const finalEnding = periodForecasts[periodForecasts.length - 1]!.endingBalance;
  const reserveExcess = finalEnding - reserveTarget;
  const runwayMonthsSimple = monthlyBurn > 0 ? startingCash / monthlyBurn : null;
  const runwayMonths = computeRunwayMonths(startingCash, periodForecasts, input.anchorDate);

  const alerts = buildAlerts({
    periodForecasts,
    events,
    reserveTarget,
    runwayMonths,
    settings,
  });

  return {
    anchorDate: input.anchorDate,
    startingCash,
    totalBankBalance,
    bankTotals: { operating: startingCash, excluded: excludedBalance, total: totalBankBalance },
    bankAccounts: accounts,
    periods: periodForecasts,
    monthlyBurn,
    monthlyBurnComputed,
    reserveTarget,
    reserveExcess,
    runwayMonthsSimple,
    runwayMonths,
    alerts,
    settings,
  };
}

function advanceAccruals(
  state: Array<{ def: Accrual; balance: number }>,
  period: Period,
): AccrualBalance[] {
  const periodDays = daysBetween(period.start, period.end) + 1;
  const monthFraction = periodDays / AVG_DAYS_PER_MONTH;
  return state.map((s) => {
    s.balance += s.def.accrualPerMonth * monthFraction;
    for (const payout of s.def.payouts ?? []) {
      if (payout.date >= period.start && payout.date <= period.end) {
        s.balance -= payout.amount;
      }
    }
    return { id: s.def.id, name: s.def.name, balance: s.balance };
  });
}

/**
 * Average monthly burn = the net cash *outflow* per month over the burn window.
 * Positive result means cash is leaving; 0 means cash-flow-neutral or positive.
 */
export function computeMonthlyBurn(
  periods: PeriodForecast[],
  anchorDate: ISODate,
  burnWindowMonths?: number,
): number {
  const included =
    burnWindowMonths === undefined
      ? periods
      : periods.filter((p) => monthsBetween(anchorDate, p.period.start) < burnWindowMonths);
  if (included.length === 0) return 0;

  const netFlow = sum(included.map((p) => p.netFlow));
  const spanDays = daysBetween(anchorDate, included[included.length - 1]!.period.end) + 1;
  const spanMonths = spanDays / AVG_DAYS_PER_MONTH;
  if (spanMonths <= 0) return 0;

  const avgMonthlyNet = netFlow / spanMonths;
  return Math.max(0, -avgMonthlyNet);
}

/**
 * Timing-aware runway: months from the anchor until projected cash first
 * crosses zero, interpolated linearly within the crossing period. Returns 0 if
 * cash starts non-positive, and null if it never goes negative in the horizon.
 */
export function computeRunwayMonths(
  startingCash: number,
  periods: PeriodForecast[],
  anchorDate: ISODate,
): number | null {
  if (startingCash <= 0) return 0;

  for (const p of periods) {
    if (p.endingBalance < 0) {
      const drop = p.beginningBalance - p.endingBalance; // > 0
      const fraction = drop > 0 ? p.beginningBalance / drop : 0;
      const periodDays = daysBetween(p.period.start, p.period.end) + 1;
      const daysFromAnchor = daysBetween(anchorDate, p.period.start) + fraction * periodDays;
      return Math.max(0, daysFromAnchor / AVG_DAYS_PER_MONTH);
    }
  }
  return null;
}

interface AlertContext {
  periodForecasts: PeriodForecast[];
  events: CashEvent[];
  reserveTarget: number;
  runwayMonths: number | null;
  settings: ForecastResult["settings"];
}

function buildAlerts(ctx: AlertContext): Alert[] {
  const alerts: Alert[] = [];
  const { periodForecasts, events, reserveTarget, runwayMonths, settings } = ctx;

  // Rule from the sheet: ending balance ≤ $0 AND overdue AR still outstanding
  // (Cash Flow conditional formatting: row 38 ≤ 0, row 9 > 0).
  for (const p of periodForecasts) {
    if (p.endingBalance > 0) continue;
    const overdueRemaining = sum(
      events
        .filter((e) => e.category === "overdueAR" && e.date >= p.period.start)
        .map(weightedAmount),
    );
    if (overdueRemaining > 0) {
      alerts.push({
        type: "negativeBalanceWithOverdueAR",
        severity: "critical",
        periodIndex: p.period.index,
        message:
          `${p.period.label}: projected ending balance ${fmt(p.endingBalance)} is at or below $0 ` +
          `while ${fmt(overdueRemaining)} of overdue AR is still outstanding — chase collections.`,
      });
    }
  }

  // First period below the reserve target.
  const belowReserve = periodForecasts.find((p) => p.endingBalance < reserveTarget);
  if (belowReserve && reserveTarget > 0) {
    alerts.push({
      type: "belowReserve",
      severity: "warning",
      periodIndex: belowReserve.period.index,
      message:
        `${belowReserve.period.label}: ending balance ${fmt(belowReserve.endingBalance)} falls ` +
        `below the reserve target of ${fmt(reserveTarget)}.`,
    });
  }

  // Low runway (whole-forecast).
  if (runwayMonths !== null && runwayMonths < settings.runwayAlertMonths) {
    alerts.push({
      type: "lowRunway",
      severity: runwayMonths < settings.runwayAlertMonths / 2 ? "critical" : "warning",
      periodIndex: null,
      message: `Runway is ${runwayMonths.toFixed(1)} months, below the ${settings.runwayAlertMonths}-month alert threshold.`,
    });
  }

  // Large single overdue AR balance.
  if (settings.largeOverdueARThreshold > 0) {
    const largest = events
      .filter((e) => e.category === "overdueAR")
      .reduce<CashEvent | null>((max, e) => (max && max.amount >= e.amount ? max : e), null);
    if (largest && largest.amount > settings.largeOverdueARThreshold) {
      alerts.push({
        type: "largeOverdueAR",
        severity: "warning",
        periodIndex: null,
        message:
          `Large overdue AR of ${fmt(largest.amount)}` +
          (largest.memo ? ` (${largest.memo})` : "") +
          ` exceeds the ${fmt(settings.largeOverdueARThreshold)} threshold.`,
      });
    }
  }

  return alerts;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

// Re-exported so callers iterating breakdowns don't re-import from types.
export { RECEIPT_CATEGORIES, DISBURSEMENT_CATEGORIES };
