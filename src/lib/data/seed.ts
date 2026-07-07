/**
 * Seed data for v1. Bank balances are the real figures from the latest sheet;
 * the flows are representative SAMPLE items so the dashboard is meaningful out
 * of the box. Everything here is editable in the Assumptions panel and persists
 * to the browser. Live syncs (QBO/Bill.com/bank/CRM) will replace the samples.
 */

import type { ForecastInput } from "@engine/index.js";
import type { Scenario } from "@engine/index.js";

export const SEED_ANCHOR = "2026-07-06";

export const SEED_INPUT: ForecastInput = {
  anchorDate: SEED_ANCHOR,
  // Real balances from the sheet. Only Checking + Savings are operating.
  bankAccounts: [
    { id: "chk", name: "Checking", mask: "0377", beginningBalance: 380_944.6 },
    { id: "sav", name: "Savings", mask: "1535", beginningBalance: 253_517.57 },
    { id: "hysa", name: "HYSA", beginningBalance: 0, operating: false },
    { id: "shr", name: "Shareholder", mask: "8987", beginningBalance: 89_988.84, operating: false },
    { id: "prod", name: "Production", beginningBalance: 685_655.51, operating: false },
  ],
  // --- SAMPLE flows (edit or replace with synced data) ---
  recurring: [
    { id: "payroll", category: "payroll", amount: 150_000, frequency: "semimonthly", startDate: SEED_ANCHOR, memo: "Payroll (sample)" },
    { id: "opex", category: "operatingExpense", amount: 80_000, frequency: "monthly", startDate: SEED_ANCHOR, memo: "Operating expense (sample)" },
    { id: "amex", category: "amex", amount: 40_000, frequency: "monthly", startDate: SEED_ANCHOR, memo: "American Express (sample)" },
    { id: "brandy", category: "otherWithdrawals", amount: 18_693, frequency: "monthly", startDate: "2026-08-01", memo: "Brandy monthly payment" },
  ],
  events: [
    { id: "ar1", category: "currentAR", amount: 120_000, date: "2026-07-17", memo: "Reel Products (sample)" },
    { id: "ar2", category: "currentAR", amount: 95_000, date: "2026-07-31", memo: "Retainer batch (sample)" },
    { id: "ar3", category: "currentAR", amount: 140_000, date: "2026-08-21", memo: "Project milestone (sample)" },
    { id: "od1", category: "overdueAR", amount: 62_000, date: "2026-07-13", memo: "Overdue — Acme (sample)" },
    { id: "ni1", category: "notInvoiced", amount: 70_000, date: "2026-08-10", memo: "Won, not yet invoiced (sample)" },
    { id: "tax", category: "otherWithdrawals", amount: 90_000, date: "2026-09-15", memo: "Quarterly tax set-aside (sample)" },
    { id: "dist", category: "otherWithdrawals", amount: 75_000, date: "2026-10-01", memo: "Owner distribution (sample)" },
  ],
  pipeline: [
    { id: "p1", name: "New logo — Q3", value: 240_000, probability: 0.4, expectedCloseDate: "2026-08-15", collectionLagDays: 45 },
    { id: "p2", name: "Expansion — retainer", value: 180_000, probability: 0.6, expectedCloseDate: "2026-09-01", collectionLagDays: 30 },
  ],
  includePipeline: false,
  includeBudgeted: false,
  accruals: [
    { id: "bonus", name: "Bonus", beginningBalance: 220_000, accrualPerMonth: 25_000 },
    { id: "cordelle", name: "Cordelle Payment", beginningBalance: 60_000, accrualPerMonth: 0 },
    { id: "commission", name: "Commission", beginningBalance: 45_000, accrualPerMonth: 8_000 },
    { id: "tax", name: "Tax", beginningBalance: 130_000, accrualPerMonth: 30_000 },
  ],
  horizon: { weeklyPeriods: 13, monthlyPeriods: 12 },
  settings: {
    reserveMultiple: 3,
    runwayAlertMonths: 6,
    largeOverdueARThreshold: 50_000,
    monthlyBurnOverride: 440_000,
  },
};

export const SEED_SCENARIOS: Scenario[] = [
  {
    id: "hire-2",
    name: "Hire 2 (Sr Eng + PM)",
    description: "Two Q4 hires with a 3-month cost ramp.",
    levers: [
      { kind: "hire", role: "Sr Engineer", annualComp: 240_000, startDate: "2026-10-01", rampMonths: 3, rampStartPct: 60 },
      { kind: "hire", role: "Project Lead", annualComp: 150_000, startDate: "2026-11-01" },
    ],
  },
  {
    id: "churn-risk",
    name: "Lose a top retainer",
    description: "Largest retainer churns in September.",
    levers: [{ kind: "churn", client: "Top retainer", monthlyAmount: 60_000, effectiveDate: "2026-09-01" }],
  },
];
