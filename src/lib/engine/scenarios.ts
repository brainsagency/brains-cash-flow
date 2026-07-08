/**
 * First-class scenarios: named, forkable, comparable — not "PLAY rows".
 *
 * A scenario is a base `ForecastInput` plus an ordered list of levers. Each
 * lever is a pure `(input) => input` transform, so scenarios compose and can be
 * forked (copy + tweak) and compared (diff two results) without side effects.
 *
 * Levers mirror the real decisions the team models: hiring, layoffs/RIF,
 * client churn, pipeline sensitivity, and collection timing.
 */

import { addDays, addMonths, type ISODate } from "./dates.js";
import { forecast } from "./forecast.js";
import type { CashEvent, ForecastInput, ForecastResult, RecurringItem } from "./types.js";

// ---------------------------------------------------------------------------
// Levers
// ---------------------------------------------------------------------------

/** Add a role: monthly comp from `startDate`, with an optional cost ramp. */
export interface HireLever {
  kind: "hire";
  role: string;
  /** Annual fully-loaded compensation. */
  annualComp: number;
  startDate: ISODate;
  /**
   * Months over which cost ramps from `rampStartPct` to 100%. 0/undefined =
   * full cost immediately. Models comp that starts partial (e.g. part-time →
   * full-time, or a signing ramp).
   */
  rampMonths?: number;
  /** Starting percent of comp during the ramp (0..100). Defaults to 100. */
  rampStartPct?: number;
}

/** Remove a role from `effectiveDate`; optional one-time severance. */
export interface LayoffLever {
  kind: "layoff";
  role: string;
  /** Monthly payroll cost removed (must match what's in the base payroll). */
  monthlySalary: number;
  effectiveDate: ISODate;
  /** One-time severance paid on `effectiveDate`. */
  severance?: number;
}

/** Drop a client retainer from `effectiveDate`. */
export interface ChurnLever {
  kind: "churn";
  client: string;
  /** Monthly retainer lost. Ignored when `recurringId` is given. */
  monthlyAmount: number;
  effectiveDate: ISODate;
  /**
   * If the retainer exists as a base recurring item, its id — the lever
   * truncates that item instead of layering a negative offset (cleaner).
   */
  recurringId?: string;
}

/** Scale win rates and/or slip expected close dates for all pipeline deals. */
export interface PipelineSensitivityLever {
  kind: "pipelineSensitivity";
  /** Multiplier on every deal's probability (clamped to [0,1]). Default 1. */
  winRateMultiplier?: number;
  /** Shift every deal's expected close by N days (+ = later). Default 0. */
  slipDays?: number;
}

/** Speed up (negative) or slow down (positive) overdue AR collection. */
export interface CollectionTimingLever {
  kind: "collectionTiming";
  /** Days to shift overdue AR receipts (+ = slower, − = faster). */
  overdueShiftDays: number;
}

/**
 * Lay off a group of real roster people from `effectiveDate`. Each person's
 * expanded payroll (items id-prefixed `staff:<id>:`) is truncated at the date,
 * and severance = `severanceMonths` × their monthly pay lands on that date.
 * Operates on the already-expanded input, so it tracks current salaries.
 */
export interface LayoffGroupLever {
  kind: "layoffGroup";
  staffIds: string[];
  effectiveDate: ISODate;
  /** Months of pay as severance per person (0 / undefined = none). */
  severanceMonths?: number;
  label?: string;
}

/** Add revenue — a one-off lump on a date, or a recurring monthly amount. */
export interface AddRevenueLever {
  kind: "addRevenue";
  mode: "oneoff" | "recurring";
  amount: number;
  /** One-off receipt date. */
  date?: ISODate;
  /** Recurring start / optional end. */
  startDate?: ISODate;
  endDate?: ISODate;
  label?: string;
}

export type Lever =
  | HireLever
  | LayoffLever
  | LayoffGroupLever
  | AddRevenueLever
  | ChurnLever
  | PipelineSensitivityLever
  | CollectionTimingLever;

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  levers: Lever[];
  /** Override the base pipeline toggle for this scenario, if set. */
  includePipeline?: boolean;
}

// ---------------------------------------------------------------------------
// Applying levers
// ---------------------------------------------------------------------------

function clone(input: ForecastInput): ForecastInput {
  // Inputs are plain JSON data (strings/numbers/arrays/objects), so a JSON
  // round-trip is a safe deep clone and keeps the engine free of any runtime
  // (Node/DOM) dependency.
  return JSON.parse(JSON.stringify(input)) as ForecastInput;
}

export function applyLever(input: ForecastInput, lever: Lever): ForecastInput {
  const next = clone(input);
  next.recurring ??= [];
  next.events ??= [];
  next.pipeline ??= [];

  switch (lever.kind) {
    case "hire":
      applyHire(next, lever);
      break;
    case "layoff":
      applyLayoff(next, lever);
      break;
    case "layoffGroup":
      applyLayoffGroup(next, lever);
      break;
    case "addRevenue":
      applyAddRevenue(next, lever);
      break;
    case "churn":
      applyChurn(next, lever);
      break;
    case "pipelineSensitivity":
      applyPipelineSensitivity(next, lever);
      break;
    case "collectionTiming":
      applyCollectionTiming(next, lever);
      break;
  }
  return next;
}

function applyHire(input: ForecastInput, lever: HireLever): void {
  const monthlyComp = lever.annualComp / 12;
  const item: RecurringItem = {
    id: `hire:${lever.role}`,
    category: "payroll",
    amount: monthlyComp,
    frequency: "monthly",
    startDate: lever.startDate,
    memo: `Hire: ${lever.role}`,
  };
  input.recurring!.push(item);

  const rampMonths = lever.rampMonths ?? 0;
  const startPct = lever.rampStartPct ?? 100;
  if (rampMonths > 0 && startPct < 100) {
    const startFraction = clamp01(startPct / 100);
    for (let k = 0; k < rampMonths; k++) {
      // Linear ramp: month k pays `fraction` of comp, reaching 100% at the end.
      const fraction = Math.min(1, startFraction + (1 - startFraction) * ((k + 1) / rampMonths));
      const discount = monthlyComp * (1 - fraction);
      if (discount === 0) continue;
      input.events!.push({
        category: "payroll",
        amount: -discount, // negative disbursement = ramp savings
        date: addMonths(lever.startDate, k),
        memo: `Ramp discount: ${lever.role} (month ${k + 1})`,
      });
    }
  }
}

function applyLayoff(input: ForecastInput, lever: LayoffLever): void {
  input.recurring!.push({
    id: `layoff:${lever.role}`,
    category: "payroll",
    amount: -lever.monthlySalary, // removes ongoing payroll
    frequency: "monthly",
    startDate: lever.effectiveDate,
    memo: `Layoff: ${lever.role}`,
  });
  if (lever.severance && lever.severance > 0) {
    input.events!.push({
      category: "payroll",
      amount: lever.severance,
      date: lever.effectiveDate,
      memo: `Severance: ${lever.role}`,
    });
  }
}

/** Monthly-equivalent amount of a recurring item. */
function monthlyEquiv(item: RecurringItem): number {
  switch (item.frequency) {
    case "weekly":
      return (item.amount * 52) / 12;
    case "biweekly":
      return (item.amount * 26) / 12;
    case "semimonthly":
      return item.amount * 2;
    case "monthly":
      return item.amount;
  }
}

function applyLayoffGroup(input: ForecastInput, lever: LayoffGroupLever): void {
  const cutoff = addDays(lever.effectiveDate, -1);
  const months = lever.severanceMonths ?? 0;
  const covers = (item: RecurringItem) =>
    item.startDate <= lever.effectiveDate && (!item.endDate || item.endDate >= lever.effectiveDate);

  for (const id of lever.staffIds) {
    const prefix = `staff:${id}:`;
    let monthlyAtLayoff = 0;
    for (const item of input.recurring!) {
      if (!item.id || !item.id.startsWith(prefix)) continue;
      if (covers(item)) monthlyAtLayoff += monthlyEquiv(item);
      // Stop the pay at the layoff date (never extend an earlier end).
      item.endDate = item.endDate && item.endDate < cutoff ? item.endDate : cutoff;
    }
    if (months > 0 && monthlyAtLayoff > 0) {
      input.events!.push({
        id: `layoff-sev:${id}`,
        category: "payroll",
        amount: monthlyAtLayoff * months,
        date: lever.effectiveDate,
        memo: `Severance (${months}mo)`,
      });
    }
  }
}

function applyAddRevenue(input: ForecastInput, lever: AddRevenueLever): void {
  const memo = lever.label || "Added revenue";
  if (lever.mode === "oneoff" && lever.date) {
    input.events!.push({ category: "pipeline", amount: lever.amount, date: lever.date, memo });
  } else if (lever.mode === "recurring" && lever.startDate) {
    input.recurring!.push({
      category: "pipeline",
      amount: lever.amount,
      frequency: "monthly",
      startDate: lever.startDate,
      ...(lever.endDate ? { endDate: lever.endDate } : {}),
      memo,
    });
  }
}

function applyChurn(input: ForecastInput, lever: ChurnLever): void {
  if (lever.recurringId) {
    const item = input.recurring!.find((r) => r.id === lever.recurringId);
    if (item) {
      const truncated = addDays(lever.effectiveDate, -1);
      // Only shorten; never extend an item that already ends earlier.
      item.endDate = item.endDate && item.endDate < truncated ? item.endDate : truncated;
      return;
    }
    // Fall through to offset if the id wasn't found.
  }
  input.recurring!.push({
    id: `churn:${lever.client}`,
    category: "currentAR",
    amount: -lever.monthlyAmount, // removes ongoing receipt
    frequency: "monthly",
    startDate: lever.effectiveDate,
    memo: `Churn: ${lever.client}`,
  });
}

function applyPipelineSensitivity(input: ForecastInput, lever: PipelineSensitivityLever): void {
  const mult = lever.winRateMultiplier ?? 1;
  const slip = lever.slipDays ?? 0;
  input.pipeline = input.pipeline!.map((deal) => ({
    ...deal,
    // Scale win rate (legacy deals only) and slip both the legacy close date
    // and every scheduled billing.
    probability: deal.probability !== undefined ? clamp01(deal.probability * mult) : deal.probability,
    expectedCloseDate:
      slip !== 0 && deal.expectedCloseDate ? addDays(deal.expectedCloseDate, slip) : deal.expectedCloseDate,
    billings:
      slip !== 0 && deal.billings
        ? deal.billings.map((b) => ({ ...b, date: addDays(b.date, slip) }))
        : deal.billings,
  }));
}

function applyCollectionTiming(input: ForecastInput, lever: CollectionTimingLever): void {
  if (lever.overdueShiftDays === 0) return;
  input.events = input.events!.map((e: CashEvent) =>
    e.category === "overdueAR"
      ? { ...e, date: addDays(e.date, lever.overdueShiftDays) }
      : e,
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// Scenario orchestration
// ---------------------------------------------------------------------------

/** Fold every lever over the base input to produce the scenario's input. */
export function applyScenario(base: ForecastInput, scenario: Scenario): ForecastInput {
  let input = clone(base);
  if (scenario.includePipeline !== undefined) {
    input.includePipeline = scenario.includePipeline;
  }
  for (const lever of scenario.levers) {
    input = applyLever(input, lever);
  }
  return input;
}

/** Run a scenario end-to-end. */
export function runScenario(base: ForecastInput, scenario: Scenario): ForecastResult {
  return forecast(applyScenario(base, scenario));
}

/** Copy a scenario with a new identity and optional extra/overridden levers. */
export function forkScenario(
  source: Scenario,
  overrides: { id: string; name: string; description?: string; addLevers?: Lever[] },
): Scenario {
  return {
    id: overrides.id,
    name: overrides.name,
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    levers: [...source.levers, ...(overrides.addLevers ?? [])],
    ...(source.includePipeline !== undefined ? { includePipeline: source.includePipeline } : {}),
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface PeriodDelta {
  index: number;
  label: string;
  endingBalanceA: number;
  endingBalanceB: number;
  /** B − A. */
  delta: number;
}

export interface ScenarioComparison {
  /** Per-period ending-balance deltas (B − A), aligned by index. */
  periods: PeriodDelta[];
  runwayMonthsA: number | null;
  runwayMonthsB: number | null;
  /** B − A runway, in months. null if either side never runs out. */
  runwayDeltaMonths: number | null;
  finalEndingA: number;
  finalEndingB: number;
  finalEndingDelta: number;
  reserveExcessA: number;
  reserveExcessB: number;
}

/** Compare two forecast results (A = baseline, B = alternative). */
export function compareScenarios(a: ForecastResult, b: ForecastResult): ScenarioComparison {
  const n = Math.min(a.periods.length, b.periods.length);
  const periods: PeriodDelta[] = [];
  for (let i = 0; i < n; i++) {
    const pa = a.periods[i]!;
    const pb = b.periods[i]!;
    periods.push({
      index: i,
      label: pa.period.label,
      endingBalanceA: pa.endingBalance,
      endingBalanceB: pb.endingBalance,
      delta: pb.endingBalance - pa.endingBalance,
    });
  }

  const finalA = a.periods[a.periods.length - 1]!.endingBalance;
  const finalB = b.periods[b.periods.length - 1]!.endingBalance;

  return {
    periods,
    runwayMonthsA: a.runwayMonths,
    runwayMonthsB: b.runwayMonths,
    runwayDeltaMonths:
      a.runwayMonths !== null && b.runwayMonths !== null
        ? b.runwayMonths - a.runwayMonths
        : null,
    finalEndingA: finalA,
    finalEndingB: finalB,
    finalEndingDelta: finalB - finalA,
    reserveExcessA: a.reserveExcess,
    reserveExcessB: b.reserveExcess,
  };
}
