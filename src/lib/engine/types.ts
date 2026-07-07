/**
 * Domain types for the cash-flow forecasting engine.
 *
 * Everything here mirrors the taxonomy of the existing weekly sheet (the spec)
 * so the two reconcile line-for-line. The engine is a pure module: it takes a
 * `ForecastInput` and returns a `ForecastResult` with no I/O, no clock access,
 * and no knowledge of where the data came from.
 */

import type { ISODate } from "./dates.js";

// ---------------------------------------------------------------------------
// Line-item taxonomy (matches the sheet)
// ---------------------------------------------------------------------------

/** Cash-in categories. Overdue AR is tracked separately from current AR. */
export type ReceiptCategory =
  | "currentAR"
  | "overdueAR"
  | "notInvoiced" // Not-Sent / Not-Yet-Invoiced
  | "pipeline" // probability-weighted new business (toggleable)
  | "locDraw"; // line-of-credit draw

/** Cash-out categories. */
export type DisbursementCategory =
  | "payroll"
  | "operatingExpense"
  | "amex" // American Express
  | "otherWithdrawals" // manual judgment items (owner distributions, Brandy, etc.)
  | "accountsPayable" // known bills (Bill.com)
  | "apEstimate" // estimate for not-yet-entered bills
  | "bonusAccruals"; // bonus payouts

export type CashCategory = ReceiptCategory | DisbursementCategory;

export type Direction = "in" | "out";

/**
 * Whether a cash stream is a real commitment or a plan from the financial
 * model. The forecast includes `committed` always; `budgeted` only when
 * `includeBudgeted` is on. This is the guardrail behind integrating the model:
 * budgeted salaries/opex can inform the forecast without being mistaken for
 * real, owed cash. Defaults to `committed` when unset.
 */
export type CashBasis = "committed" | "budgeted";

export const RECEIPT_CATEGORIES: readonly ReceiptCategory[] = [
  "currentAR",
  "overdueAR",
  "notInvoiced",
  "pipeline",
  "locDraw",
];

export const DISBURSEMENT_CATEGORIES: readonly DisbursementCategory[] = [
  "payroll",
  "operatingExpense",
  "amex",
  "otherWithdrawals",
  "accountsPayable",
  "apEstimate",
  "bonusAccruals",
];

export function directionOf(category: CashCategory): Direction {
  return (RECEIPT_CATEGORIES as readonly string[]).includes(category) ? "in" : "out";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A single dated cash movement (an invoice's expected payment, a bill, etc.). */
export interface CashEvent {
  /** Stable id where one exists (invoice id, bill id, deal id); optional. */
  id?: string;
  category: CashCategory;
  /** Positive magnitude; direction is derived from the category. */
  amount: number;
  /** The date the cash is expected to actually land / leave. */
  date: ISODate;
  /**
   * Probability the event occurs (0..1). Applied as a weight to `amount`.
   * Defaults to 1. Used mainly for pipeline deals.
   */
  probability?: number;
  /** committed (real cash) vs budgeted (model plan). Defaults to committed. */
  basis?: CashBasis;
  /** Free-form label for narrative / drill-down. */
  memo?: string;
}

export type RecurringFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

/** A repeating cash movement (payroll runs, retainer receipts, rent). */
export interface RecurringItem {
  id?: string;
  category: CashCategory;
  amount: number;
  frequency: RecurringFrequency;
  /** First occurrence. */
  startDate: ISODate;
  /** Last occurrence (inclusive). Omit for open-ended (runs to horizon end). */
  endDate?: ISODate;
  /** committed (real cash) vs budgeted (model plan). Defaults to committed. */
  basis?: CashBasis;
  memo?: string;
}

/** A CRM deal, converted to a probability-weighted receipt on close + lag. */
export interface PipelineDeal {
  id: string;
  name: string;
  /** Total contract / booking value. */
  value: number;
  /** Win probability 0..1 (from CRM stage/probability). */
  probability: number;
  /** Expected close date (from CRM). */
  expectedCloseDate: ISODate;
  /** Days from close until cash collected (payment terms + collection lag). */
  collectionLagDays: number;
}

/** A bank account tracked individually and in the total. */
export interface BankAccount {
  id: string;
  name: string;
  /** Last 4 digits / mask for display, if any. */
  mask?: string;
  /** Reconciled ending balance at the anchor date (real bank balance, not QBO's). */
  beginningBalance: number;
  /**
   * Whether this account is part of *operating* cash that the forecast rolls
   * forward. Defaults to `true`. In the sheet only Checking (…0377) and Savings
   * (…1535) are operating; HYSA, Shareholder (…8987), and Production are
   * tracked for display but excluded from the operating beginning balance
   * (Cash Flow row 35 = D29+D30). Set `operating: false` for those.
   */
  operating?: boolean;
}

/**
 * A tracked accrual balance (Bonus, Cordelle, Commission, Tax).
 * Balance grows by `accrualPerMonth` and is reduced by payout events.
 */
export interface Accrual {
  id: string;
  name: string;
  /** Balance at the anchor date. */
  beginningBalance: number;
  /** Amount accrued per month (added over the horizon). 0 for static balances. */
  accrualPerMonth: number;
  /**
   * Scheduled payouts that reduce the balance. These should ALSO appear as
   * disbursement `CashEvent`s if they move cash; the accrual only tracks the
   * liability balance, not the cash side.
   */
  payouts?: Array<{ date: ISODate; amount: number }>;
}

/** How the rolling horizon is shaped: N weekly periods, then M monthly. */
export interface HorizonConfig {
  /** Number of weekly periods from the anchor (sheet uses ≥13). */
  weeklyPeriods: number;
  /** Number of monthly periods to append after the weekly window (sheet uses 12). */
  monthlyPeriods: number;
}

export const DEFAULT_HORIZON: HorizonConfig = { weeklyPeriods: 13, monthlyPeriods: 12 };

/** Tunable thresholds for burn, reserve, and alerts. */
export interface ForecastSettings {
  /** Reserve target = `reserveMultiple` × monthly burn. Sheet uses 3. */
  reserveMultiple: number;
  /** Alert when timing-aware runway drops below this many months. */
  runwayAlertMonths: number;
  /** Alert when a single overdue AR balance exceeds this (0 disables). */
  largeOverdueARThreshold: number;
  /**
   * Window (in months) over which average monthly burn is computed.
   * Omit to use the full horizon. Ignored when `monthlyBurnOverride` is set.
   */
  burnWindowMonths?: number;
  /**
   * Hard-keyed monthly burn, matching the sheet's judgment input (row 40, e.g.
   * 440,000). When set, this — not the projection-derived value — drives the
   * reserve target. The derived figure is still returned as
   * `monthlyBurnComputed` for comparison.
   */
  monthlyBurnOverride?: number;
  /**
   * A minimum cash "floor" the business doesn't want to drop below (distinct
   * from the larger 3× reserve target). Drives the chart's danger line and the
   * "drops below $X" runway stat. Defaults to 250,000.
   */
  lowCashThreshold?: number;
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  reserveMultiple: 3,
  runwayAlertMonths: 6,
  largeOverdueARThreshold: 50_000,
  lowCashThreshold: 250_000,
};

/** Everything the engine needs to produce a forecast. Fully self-contained. */
export interface ForecastInput {
  /** "Today" for this run. All periods are generated relative to this. */
  anchorDate: ISODate;
  bankAccounts: BankAccount[];
  /** One-off dated events (from AR/AP syncs or manual entry). */
  events?: CashEvent[];
  /** Repeating items (payroll, retainers, rent). */
  recurring?: RecurringItem[];
  /** CRM deals; only counted when `includePipeline` is true. */
  pipeline?: PipelineDeal[];
  /** Toggle for pipeline revenue (matches the sheet's pipeline toggle). */
  includePipeline?: boolean;
  /**
   * Include `budgeted`-basis streams (planned salaries/opex from the financial
   * model). Defaults to false: the official forecast is committed-only. Turn on
   * to see the model's plan flow through to cash.
   */
  includeBudgeted?: boolean;
  accruals?: Accrual[];
  horizon?: HorizonConfig;
  settings?: ForecastSettings;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type Granularity = "week" | "month";

export interface Period {
  index: number;
  granularity: Granularity;
  /** Inclusive start date. */
  start: ISODate;
  /** Inclusive end date. */
  end: ISODate;
  /** Human label, e.g. "Wk of 2026-07-06" or "2026-08". */
  label: string;
}

export type ReceiptBreakdown = Record<ReceiptCategory, number>;
export type DisbursementBreakdown = Record<DisbursementCategory, number>;

export interface AccrualBalance {
  id: string;
  name: string;
  balance: number;
}

export interface PeriodForecast {
  period: Period;
  beginningBalance: number;
  receipts: ReceiptBreakdown;
  totalReceipts: number;
  disbursements: DisbursementBreakdown;
  totalDisbursements: number;
  netFlow: number;
  endingBalance: number;
  /** endingBalance − reserveTarget for this period (>0 excess, <0 shortfall). */
  reserveExcess: number;
  /** Accrual balances at period end. */
  accruals: AccrualBalance[];
}

export type AlertType =
  | "negativeBalanceWithOverdueAR" // the sheet's core rule
  | "belowReserve"
  | "lowRunway"
  | "largeOverdueAR";

export type AlertSeverity = "critical" | "warning";

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  /** Period index the alert refers to, or null for whole-forecast alerts. */
  periodIndex: number | null;
  message: string;
}

export interface ForecastResult {
  anchorDate: ISODate;
  /** Operating cash at the anchor = sum of accounts with `operating !== false`. */
  startingCash: number;
  /** Sum of ALL bank account balances (operating + reserve), for display. */
  totalBankBalance: number;
  /** Subtotals so a settings UI can show what's included in operating cash. */
  bankTotals: {
    /** Sum of accounts with `operating !== false` (== startingCash). */
    operating: number;
    /** Sum of accounts explicitly marked `operating: false`. */
    excluded: number;
    /** operating + excluded (== totalBankBalance). */
    total: number;
  };
  bankAccounts: BankAccount[];
  periods: PeriodForecast[];
  /** Monthly burn actually used: `monthlyBurnOverride` if set, else computed. */
  monthlyBurn: number;
  /** Projection-derived monthly burn, always computed (cross-check vs override). */
  monthlyBurnComputed: number;
  /** reserveMultiple × monthlyBurn. */
  reserveTarget: number;
  /** endingCash − reserveTarget at the final period (>0 excess, <0 shortfall). */
  reserveExcess: number;
  /** startingCash / monthlyBurn, in months (naive). null if burn ≤ 0. */
  runwayMonthsSimple: number | null;
  /**
   * Timing-aware runway: months from anchor until projected cash first hits 0,
   * interpolated within the crossing period. null if cash never goes negative
   * within the horizon.
   */
  runwayMonths: number | null;
  alerts: Alert[];
  settings: ForecastSettings;
}
