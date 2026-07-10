/**
 * Public API for the cash-flow forecasting engine.
 *
 * This module is pure and dependency-free: inputs → weekly/monthly series →
 * balances → runway, independent of the UI, the database, and the integration
 * sync layer. Import from here; the internal file layout may change.
 */

export * from "./dates.js";
export * from "./types.js";
export { buildPeriods, periodIndexForDate } from "./periods.js";
export { expandRecurring, pipelineToEvent, pipelineToEvents } from "./events.js";
export {
  forecast,
  collectEvents,
  weightedAmount,
  computeMonthlyBurn,
  computeRunwayMonths,
} from "./forecast.js";
export {
  applyLever,
  applyScenario,
  runScenario,
  forkScenario,
  compareScenarios,
} from "./scenarios.js";
export type {
  Lever,
  HireLever,
  LayoffLever,
  ChurnLever,
  PipelineSensitivityLever,
  CollectionTimingLever,
  Scenario,
  PeriodDelta,
  ScenarioComparison,
} from "./scenarios.js";
export { monthlyRollup } from "./rollup.js";
export type { MonthlyRow } from "./rollup.js";
export { narrate } from "./narrative.js";
export { staffToPayroll, terminationFinalPay } from "./adapters/staff.js";
export type { StaffMember, StaffToPayrollOptions } from "./adapters/staff.js";
