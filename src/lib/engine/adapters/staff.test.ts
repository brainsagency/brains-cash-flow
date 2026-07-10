import { describe, expect, it } from "vitest";
import { forecast } from "../forecast.js";
import { staffToPayroll, terminationFinalPay, type StaffMember } from "./staff.js";

describe("terminationFinalPay", () => {
  const ANNUAL = 120_000; // half-month = 5,000
  it("prorates the days worked in the final first-half period, term date exclusive", () => {
    // Term 8/4 → 3 days worked (1st–3rd) of the 15-day first-half period.
    expect(terminationFinalPay(ANNUAL, "2026-08-04")).toBeCloseTo(5_000 * (3 / 15), 5);
  });
  it("prorates the second-half period against its own length", () => {
    // Term 8/20 → 4 days worked (16th–19th); Aug's second half is 16 days.
    expect(terminationFinalPay(ANNUAL, "2026-08-20")).toBeCloseTo(5_000 * (4 / 16), 5);
  });
  it("returns 0 when the term date is itself a payday (a full check already lands)", () => {
    expect(terminationFinalPay(ANNUAL, "2026-08-01")).toBe(0);
    expect(terminationFinalPay(ANNUAL, "2026-08-15")).toBe(0);
  });
  it("returns 0 on the 16th (the 15th check already covered the first half)", () => {
    expect(terminationFinalPay(ANNUAL, "2026-08-16")).toBe(0);
  });
  it("applies the employer load, like ordinary wages", () => {
    expect(terminationFinalPay(ANNUAL, "2026-08-04", 1.15)).toBeCloseTo(5_000 * 1.15 * (3 / 15), 5);
  });
  it("handles February's short second half", () => {
    // 2026 is not a leap year → Feb has 28 days, second half = 13 days.
    expect(terminationFinalPay(ANNUAL, "2026-02-20")).toBeCloseTo(5_000 * (4 / 13), 5);
  });
});

describe("staffToPayroll", () => {
  it("emits one semi-monthly item for a plain salaried employee", () => {
    const items = staffToPayroll([
      { id: "1", name: "Sarah Bowman", annualSalary: 90_070.7, doh: "2022-05-24" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.category).toBe("payroll");
    expect(items[0]!.frequency).toBe("semimonthly");
    expect(items[0]!.amount).toBeCloseTo(90_070.7 / 24, 2); // per pay run (1st & 15th)
    expect(items[0]!.basis).toBe("budgeted"); // default: a plan, not owed cash
  });

  it("splits into pre- and post-raise items at the change date", () => {
    const staff: StaffMember[] = [
      {
        id: "7",
        name: "Leah Chew",
        annualSalary: 115_000,
        doh: "2023-01-01",
        salaryChangeDate: "2026-10-01",
        newSalary: 118_450,
      },
    ];
    const items = staffToPayroll(staff);
    expect(items).toHaveLength(2);
    const [pre, post] = items;
    expect(pre!.amount).toBeCloseTo(115_000 / 24, 2);
    expect(pre!.endDate).toBe("2026-09-30"); // day before the raise
    expect(post!.amount).toBeCloseTo(118_450 / 24, 2);
    expect(post!.startDate).toBe("2026-10-01");
    expect(post!.endDate).toBeUndefined();
  });

  it("caps payroll at termination (DOT)", () => {
    const items = staffToPayroll([
      { id: "11", name: "Kimberly Farrow", annualSalary: 85_696, doh: "2022-01-01", dot: "2026-07-06" },
    ]);
    expect(items[0]!.endDate).toBe("2026-07-06");
  });

  it("drops the post-raise item when termination precedes the raise", () => {
    const items = staffToPayroll([
      {
        id: "x",
        name: "Someone",
        annualSalary: 100_000,
        doh: "2022-01-01",
        dot: "2026-05-01",
        salaryChangeDate: "2026-10-01",
        newSalary: 120_000,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.endDate).toBe("2026-05-01");
  });

  it("applies a load factor for employer burden", () => {
    const items = staffToPayroll(
      [{ id: "1", name: "X", annualSalary: 120_000, doh: "2020-01-01" }],
      { loadFactor: 1.15 },
    );
    expect(items[0]!.amount).toBeCloseTo((120_000 * 1.15) / 24, 2);
  });

  it("lets active staff be marked committed while future hires stay budgeted", () => {
    const staff: StaffMember[] = [
      { id: "active", name: "Now", annualSalary: 100_000, doh: "2022-01-01" },
      { id: "future", name: "Later", annualSalary: 100_000, doh: "2026-12-01" },
    ];
    const items = staffToPayroll(staff, {
      basisFor: (m) => (m.doh <= "2026-07-06" ? "committed" : "budgeted"),
    });
    expect(items.find((i) => i.id?.includes("active"))!.basis).toBe("committed");
    expect(items.find((i) => i.id?.includes("future"))!.basis).toBe("budgeted");
  });

  it("feeds the forecast as payroll disbursements when budgeted is included", () => {
    const items = staffToPayroll([
      { id: "1", name: "X", annualSalary: 120_000, doh: "2020-01-01" },
    ]);
    const result = forecast({
      anchorDate: "2026-07-06",
      bankAccounts: [{ id: "op", name: "Op", beginningBalance: 500_000 }],
      recurring: items,
      includeBudgeted: true,
    });
    const totalPayroll = result.periods.reduce((s, p) => s + p.disbursements.payroll, 0);
    expect(totalPayroll).toBeGreaterThan(0);
  });
});
