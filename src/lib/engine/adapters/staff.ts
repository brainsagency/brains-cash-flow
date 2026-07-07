/**
 * Financial-model integration: Staff roster → engine payroll inputs.
 *
 * The model's Staff tab is the authoritative payroll projection. Each person
 * has an annual salary, a hire date (DOH), an optional termination date (DOT),
 * and an optional scheduled raise (a change date + new salary). Its monthly
 * matrix (one column per month) is just that logic spread out; we reproduce the
 * logic directly so the cash-flow tool and the model stay in sync.
 *
 * **Budget-vs-cash guardrail.** Salaries are a *plan*, not owed cash. By default
 * every generated payroll stream is tagged `budgeted`, so it only reaches the
 * forecast when `includeBudgeted` is on. Actual payroll cash still comes from
 * the payroll provider (committed). Callers can override the basis per person
 * (e.g. mark already-employed staff `committed`) via `basisFor`.
 *
 * NOTE: model salaries are *gross*. True payroll cash includes employer burden
 * (taxes, benefits, 401k match). Pass `loadFactor` (e.g. 1.15) to gross up, or
 * leave at 1 and rely on the payroll-provider sync for the loaded actuals.
 */

import { addDays, type ISODate } from "../dates.js";
import type { CashBasis, RecurringItem } from "../types.js";

export interface StaffMember {
  id: string;
  name: string;
  /** Current annual (gross) salary. */
  annualSalary: number;
  /** Date of hire. Payroll starts here (or at the forecast anchor if earlier). */
  doh: ISODate;
  /** Date of termination, if any. Payroll stops here. */
  dot?: ISODate;
  /** Effective date of a scheduled salary change, if any. */
  salaryChangeDate?: ISODate;
  /** New annual (gross) salary from `salaryChangeDate`. */
  newSalary?: number;
  /** Cost center / role, carried into the memo for drill-down. */
  costCenter?: string;
}

export interface StaffToPayrollOptions {
  /** Multiply gross salary to approximate loaded cash cost. Defaults to 1. */
  loadFactor?: number;
  /** Basis for all members unless `basisFor` overrides. Defaults to "budgeted". */
  defaultBasis?: CashBasis;
  /** Per-member basis override (e.g. active staff → "committed"). */
  basisFor?: (member: StaffMember) => CashBasis;
}

/**
 * Convert a staff roster into monthly payroll `RecurringItem`s.
 *
 * A member with a scheduled raise produces two items: the old salary from DOH
 * until the day before the change, and the new salary from the change date.
 * Termination (DOT) caps the end date. Monthly frequency matches the model's
 * per-month spread (weekly detail comes from the payroll-provider sync later).
 */
export function staffToPayroll(
  staff: StaffMember[],
  options: StaffToPayrollOptions = {},
): RecurringItem[] {
  const load = options.loadFactor ?? 1;
  const defaultBasis = options.defaultBasis ?? "budgeted";
  const items: RecurringItem[] = [];

  for (const m of staff) {
    const basis = options.basisFor ? options.basisFor(m) : defaultBasis;
    const monthly = (annual: number) => (annual * load) / 12;

    const hasRaise =
      m.salaryChangeDate !== undefined &&
      m.newSalary !== undefined &&
      // A raise on/before DOH is just the starting salary.
      m.salaryChangeDate > m.doh;

    if (!hasRaise) {
      const salary = m.newSalary !== undefined && m.salaryChangeDate !== undefined && m.salaryChangeDate <= m.doh
        ? m.newSalary
        : m.annualSalary;
      items.push(payrollItem(m, monthly(salary), m.doh, m.dot, basis, "salary"));
      continue;
    }

    // Old salary DOH → day before the raise; new salary from the raise date.
    const dayBeforeRaise = addDays(m.salaryChangeDate!, -1);
    const oldEnd = m.dot && m.dot < dayBeforeRaise ? m.dot : dayBeforeRaise;
    items.push(payrollItem(m, monthly(m.annualSalary), m.doh, oldEnd, basis, "salary (pre-raise)"));

    // Skip the new item entirely if termination precedes the raise.
    if (!m.dot || m.dot >= m.salaryChangeDate!) {
      items.push(
        payrollItem(m, monthly(m.newSalary!), m.salaryChangeDate!, m.dot, basis, "salary (post-raise)"),
      );
    }
  }

  return items;
}

function payrollItem(
  m: StaffMember,
  amount: number,
  startDate: ISODate,
  endDate: ISODate | undefined,
  basis: CashBasis,
  note: string,
): RecurringItem {
  return {
    id: `staff:${m.id}:${note}`,
    category: "payroll",
    amount,
    frequency: "monthly",
    startDate,
    ...(endDate !== undefined ? { endDate } : {}),
    basis,
    memo: `${m.name}${m.costCenter ? ` · ${m.costCenter}` : ""} — ${note}`,
  };
}
