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
  | "freelance" // freelance / contractor budget (own line, budget vs. actual)
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
  "freelance",
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
  /**
   * The source system's date (e.g. a bill's due date) before any sweep or
   * user override. Display metadata only — the engine ignores it.
   */
  originalDate?: ISODate;
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
  /**
   * Per-month actual overrides, keyed by calendar month ("YYYY-MM"). When a
   * month has an entry, that month's occurrence uses the override amount
   * instead of `amount` (the budget baseline). Intended for variable monthly
   * expenses (e.g. AmEx): budget a placeholder, then drop in actuals as each
   * month closes. Applied to `monthly`-frequency items only.
   */
  overrides?: Record<string, number>;
}

/**
 * One person on the staff roster — the authoritative payroll source when
 * present. Mirrors the model's Staff tab: annual (gross) salary, hire date,
 * optional termination date, and an optional scheduled raise. The roster is
 * expanded into payroll cash streams (see `staffToPayroll`); it is *data the
 * store reads*, not something the pure engine interprets.
 */
export interface StaffMember {
  id: string;
  name: string;
  /** Current annual (gross) salary. */
  annualSalary: number;
  /** Date of hire. Payroll starts here (or at the forecast anchor if earlier). */
  doh: ISODate;
  /** Date of termination, if any. Payroll stops here. */
  dot?: ISODate;
  /** One-time severance paid on `dot`. */
  severance?: number;
  /**
   * How severance is disbursed. "lump" (default) = one payment on `dot`.
   * "payroll" = keep the person on the normal semi-monthly paycheck (annual/24)
   * from `dot` until the severance total is paid out (final run is the
   * remainder). Vacation payout and final salary always land on `dot`.
   */
  severancePayout?: "lump" | "payroll";
  /** One-time accrued-vacation/PTO payout paid on `dot`. */
  vacationPayout?: number;
  /** Effective date of a scheduled salary change, if any. */
  salaryChangeDate?: ISODate;
  /** New annual (gross) salary from `salaryChangeDate`. */
  newSalary?: number;
  /** Cost center / role, carried into the memo for drill-down. */
  costCenter?: string;
}

/** One scheduled cash receipt for a deal (a billing / installment). */
export interface Billing {
  /** Date the cash is expected to land. */
  date: ISODate;
  /** Amount of this installment. */
  amount: number;
}

/**
 * A new-business opportunity. Cash is recognized either as an explicit
 * `billings` schedule (the primary path — projects usually bill in 3–4
 * installments over several months) or, for legacy/CRM deals, as a single
 * probability-weighted receipt on `expectedCloseDate + collectionLagDays`.
 */
export interface PipelineDeal {
  id: string;
  name: string;
  /**
   * Billing schedule: each installment lands as its own receipt on its date.
   * When present, this is authoritative and the legacy value/close/lag fields
   * are ignored.
   */
  billings?: Billing[];
  /** Total contract / booking value (legacy single-receipt path). */
  value?: number;
  /** Win probability 0..1 (legacy path). Defaults to 1 when unset. */
  probability?: number;
  /** Expected close date (legacy path). */
  expectedCloseDate?: ISODate;
  /** Days from close until cash collected (legacy path). */
  collectionLagDays?: number;
  /**
   * Per-deal toggle. `true` counts this deal regardless of the global
   * `includePipeline`; `false` never counts it. When unset, the deal follows
   * `includePipeline` (legacy behavior). Lets the UI turn individual
   * opportunities on/off to play with potential revenue.
   */
  enabled?: boolean;
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
  /**
   * Date the balance was last entered/updated (manual bank feeds). Display
   * metadata for staleness warnings; the engine ignores it.
   */
  balanceAsOf?: ISODate;
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
  /**
   * Staff roster. When non-empty, the store expands it into payroll streams
   * (via `staffToPayroll`) that supersede any manual `payroll` recurring items,
   * and adds a one-off severance disbursement on each termination date. The
   * pure engine ignores this field — expansion happens in the client store.
   */
  staff?: StaffMember[];
  /** Multiply gross salary → loaded payroll cash (taxes/benefits). Defaults to 1. */
  staffLoadFactor?: number;
  /**
   * Collection-timing assumption: shift every synced AR receipt this many days
   * past its due date, reflecting that clients rarely pay on the due date.
   * Per-invoice date overrides win over this global lag. Defaults to 0.
   */
  arCollectionLagDays?: number;
  /** CRM deals; only counted when `includePipeline` is true. */
  pipeline?: PipelineDeal[];
  /** Toggle for pipeline revenue (matches the sheet's pipeline toggle). */
  includePipeline?: boolean;
  /**
   * Payroll reconciliation cutoff: any `payroll` disbursement dated on or
   * before this date is treated as already paid (its cash has left the bank and
   * is baked into the starting balance) and is dropped from the forecast, so a
   * run that already cleared isn't subtracted a second time. Payroll often
   * debits a day or two before the pay date, so set this to the pay date of the
   * last run that actually cleared. Omit to count every scheduled run.
   */
  payrollPaidThrough?: ISODate;
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
