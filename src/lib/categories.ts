import {
  DISBURSEMENT_CATEGORIES,
  RECEIPT_CATEGORIES,
  type CashCategory,
  type DisbursementCategory,
  type ReceiptCategory,
} from "@engine/index.js";

export const CATEGORY_LABELS: Record<CashCategory, string> = {
  currentAR: "Current AR",
  overdueAR: "Overdue AR",
  notInvoiced: "Not-Yet-Invoiced",
  pipeline: "Pipeline",
  locDraw: "LOC Draw",
  payroll: "Payroll",
  operatingExpense: "Operating Expense",
  amex: "American Express",
  otherWithdrawals: "Other Withdrawals",
  accountsPayable: "Accounts Payable",
  apEstimate: "AP Estimate",
  bonusAccruals: "Bonus Accruals",
};

export const RECEIPT_ORDER: readonly ReceiptCategory[] = RECEIPT_CATEGORIES;
export const DISBURSEMENT_ORDER: readonly DisbursementCategory[] = DISBURSEMENT_CATEGORIES;
export const ALL_CATEGORIES: CashCategory[] = [...RECEIPT_CATEGORIES, ...DISBURSEMENT_CATEGORIES];

/** Base cash-balance line color (Float-style green). */
export const BASE_LINE_COLOR = "#2e7354";

/** Distinct line colors for scenario overlays (base line is green). */
export const OVERLAY_COLORS = ["#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2"];
