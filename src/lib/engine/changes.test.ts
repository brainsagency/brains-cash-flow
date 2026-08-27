import { describe, expect, it } from "vitest";
import { changeHeadline, diffForecasts, digest, narrateChanges, rebaseTo } from "./changes.js";
import type { CashChange, ForecastInput } from "./index.js";

const ANCHOR = "2026-07-06";

function base(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    anchorDate: ANCHOR,
    horizon: { weeklyPeriods: 13, monthlyPeriods: 3 },
    bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 500_000 }],
    ...overrides,
  };
}

function find(changes: CashChange[], label: string): CashChange | undefined {
  return changes.find((c) => c.label === label);
}

describe("digest", () => {
  it("collapses every occurrence of a recurring item into one line", () => {
    const lines = digest(
      base({
        recurring: [
          { id: "rent", category: "operatingExpense", amount: 10_000, frequency: "monthly", startDate: ANCHOR, memo: "Rent" },
        ],
      }),
      { start: ANCHOR, end: "2026-09-30" },
    );
    const rent = lines.get("id:rent");
    expect(rent?.count).toBe(3);
    expect(rent?.total).toBe(30_000);
    expect(rent?.firstDate).toBe(ANCHOR);
  });

  it("weights a line by its probability", () => {
    const lines = digest(
      base({ events: [{ id: "d1", category: "pipeline", amount: 100_000, date: "2026-08-01", probability: 0.4 }] }),
      { start: ANCHOR, end: "2026-09-30" },
    );
    expect(lines.get("id:d1")?.total).toBe(40_000);
  });

  it("ignores cash outside the window", () => {
    const lines = digest(
      base({ events: [{ id: "late", category: "currentAR", amount: 50_000, date: "2027-06-01" }] }),
      { start: ANCHOR, end: "2026-09-30" },
    );
    expect(lines.has("id:late")).toBe(false);
  });
});

describe("rebaseTo", () => {
  it("moves an older input onto the current anchor and horizon", () => {
    const older = base({ anchorDate: "2026-06-01", horizon: { weeklyPeriods: 4, monthlyPeriods: 1 } });
    const rebased = rebaseTo(older, base());
    expect(rebased.anchorDate).toBe(ANCHOR);
    expect(rebased.horizon).toEqual({ weeklyPeriods: 13, monthlyPeriods: 3 });
  });

  it("leaves balances and streams alone", () => {
    const older = base({ anchorDate: "2026-06-01", bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 1 }] });
    expect(rebaseTo(older, base()).bankAccounts[0]!.beginningBalance).toBe(1);
  });
});

describe("diffForecasts", () => {
  it("reports a new bill as a negative cash impact", () => {
    const after = base({ events: [{ id: "bill-9", category: "accountsPayable", amount: 42_000, date: "2026-08-03", memo: "Print vendor" }] });
    const report = diffForecasts(base(), after);
    const c = find(report.changes, "Print vendor")!;
    expect(c.kind).toBe("added");
    expect(c.cashImpact).toBe(-42_000);
    expect(report.negativeImpact).toBe(-42_000);
  });

  it("reports a new invoice as a positive cash impact", () => {
    const after = base({ events: [{ id: "inv-1", category: "currentAR", amount: 80_000, date: "2026-08-03", memo: "Acme" }] });
    const report = diffForecasts(base(), after);
    expect(find(report.changes, "Acme")?.cashImpact).toBe(80_000);
    expect(report.netImpact).toBe(80_000);
  });

  it("reports a removed disbursement as cash regained", () => {
    const before = base({ events: [{ id: "bill-9", category: "accountsPayable", amount: 42_000, date: "2026-08-03", memo: "Print vendor" }] });
    const c = find(diffForecasts(before, base()).changes, "Print vendor")!;
    expect(c.kind).toBe("removed");
    expect(c.cashImpact).toBe(42_000);
  });

  it("scores a raise across every remaining payroll run", () => {
    const stream = (amount: number) => [
      { id: "pay-jane", category: "payroll" as const, amount, frequency: "semimonthly" as const, startDate: ANCHOR, memo: "Payroll — Jane" },
    ];
    const report = diffForecasts(base({ recurring: stream(5_000) }), base({ recurring: stream(6_000) }));
    const c = find(report.changes, "Payroll — Jane")!;
    expect(c.kind).toBe("increased");
    expect(c.beforeCount).toBe(c.afterCount);
    // Every run in the window costs $1,000 more, and payroll is cash out.
    expect(c.cashImpact).toBe(-1_000 * c.afterCount!);
  });

  it("calls a same-amount date change a timing move, not a cash change", () => {
    const at = (date: string) => base({ events: [{ id: "inv-1", category: "currentAR", amount: 90_000, date, memo: "Acme" }] });
    const c = find(diffForecasts(at("2026-08-03"), at("2026-08-24")).changes, "Acme")!;
    expect(c.kind).toBe("moved");
    expect(c.cashImpact).toBe(0);
    expect(c.dayShift).toBe(21);
  });

  it("ranks timing moves below real cash impacts", () => {
    const before = base({
      events: [
        { id: "inv-1", category: "currentAR", amount: 90_000, date: "2026-08-03", memo: "Acme" },
        { id: "bill-1", category: "accountsPayable", amount: 30_000, date: "2026-08-05", memo: "Vendor" },
      ],
    });
    const after = base({
      events: [
        { id: "inv-1", category: "currentAR", amount: 90_000, date: "2026-08-24", memo: "Acme" },
        { id: "bill-1", category: "accountsPayable", amount: 55_000, date: "2026-08-05", memo: "Vendor" },
      ],
    });
    expect(diffForecasts(before, after).changes.map((c) => c.label)).toEqual(["Vendor", "Acme"]);
  });

  it("ignores an immaterial change but keeps it in the reconciling total", () => {
    const at = (amount: number) => base({ events: [{ id: "bill-1", category: "accountsPayable", amount, date: "2026-08-05", memo: "Vendor" }] });
    const report = diffForecasts(at(30_000), at(30_400), { minImpact: 2_500 });
    expect(report.changes).toHaveLength(0);
    expect(report.omittedCount).toBe(1);
    expect(report.omittedImpact).toBe(-400);
  });

  it("surfaces a re-synced bank balance as its own line", () => {
    const after = base({ bankAccounts: [{ id: "op", name: "Operating", mask: "0377", beginningBalance: 560_000 }] });
    const c = find(diffForecasts(base(), after).changes, "Operating ····0377 balance")!;
    expect(c.kind).toBe("balance");
    expect(c.cashImpact).toBe(60_000);
  });

  it("gives a non-operating account's balance move no cash impact", () => {
    const acct = (beginningBalance: number) => [
      { id: "op", name: "Operating", beginningBalance: 500_000 },
      { id: "hysa", name: "HYSA", beginningBalance, operating: false },
    ];
    const report = diffForecasts(base({ bankAccounts: acct(100_000) }), base({ bankAccounts: acct(300_000) }));
    expect(find(report.changes, "HYSA balance")?.cashImpact).toBe(0);
  });

  it("does not invent changes when nothing moved but the anchor", () => {
    const stream = {
      recurring: [
        { id: "rent", category: "operatingExpense" as const, amount: 10_000, frequency: "monthly" as const, startDate: "2026-06-01", memo: "Rent" },
      ],
    };
    const before = base({ ...stream, anchorDate: "2026-06-01" });
    const report = diffForecasts(before, base(stream));
    expect(report.changes).toHaveLength(0);
    expect(report.netImpact).toBe(0);
  });

  it("reconciles: the bullets sum to the move in projected cash", () => {
    // The property that makes the panel trustworthy — if a bullet is missing or
    // double-counted, the net stops matching the forecast's own ending balance.
    const before = base({
      events: [{ id: "inv-1", category: "currentAR", amount: 120_000, date: "2026-08-03", memo: "Acme" }],
      recurring: [{ id: "amex", category: "amex", amount: 40_000, frequency: "monthly", startDate: ANCHOR, memo: "AmEx" }],
    });
    const after = base({
      bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 440_000 }],
      events: [
        { id: "inv-1", category: "currentAR", amount: 120_000, date: "2026-08-03", memo: "Acme" },
        { id: "bill-new", category: "accountsPayable", amount: 62_500, date: "2026-09-15", memo: "Media buy" },
      ],
      recurring: [{ id: "amex", category: "amex", amount: 49_000, frequency: "monthly", startDate: ANCHOR, memo: "AmEx" }],
    });
    const report = diffForecasts(before, after);
    const ending = report.metrics.find((m) => m.key === "endingCash")!;
    expect(report.netImpact + report.omittedImpact).toBeCloseTo(ending.delta!, 6);
  });

  it("tracks runway and cash-on-hand as metrics", () => {
    const after = base({ bankAccounts: [{ id: "op", name: "Operating", beginningBalance: 400_000 }] });
    const metrics = diffForecasts(base(), after).metrics;
    expect(metrics.find((m) => m.key === "startingCash")?.delta).toBe(-100_000);
    expect(metrics.map((m) => m.key)).toContain("runwayMonths");
  });

  it("caps the bullet list and rolls the rest into the omitted total", () => {
    const events = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `bill-${i}`,
        category: "accountsPayable" as const,
        amount: 10_000,
        date: "2026-08-05",
        memo: `Vendor ${i}`,
      }));
    const report = diffForecasts(base(), base({ events: events(6) }), { limit: 4 });
    expect(report.changes).toHaveLength(4);
    expect(report.omittedCount).toBe(2);
    expect(report.omittedImpact).toBe(-20_000);
  });
});

describe("changeHeadline", () => {
  const at = (over: Partial<CashChange>): CashChange => ({
    key: "k",
    label: "Line",
    kind: "added",
    cashImpact: -1,
    before: 0,
    after: 1,
    ...over,
  });

  it("names a one-off cost and a recurring one differently", () => {
    const one = at({ category: "operatingExpense", direction: "out", afterCount: 1 });
    const many = at({ category: "operatingExpense", direction: "out", afterCount: 12 });
    expect(changeHeadline(one)).toBe("New one-time expense");
    expect(changeHeadline(many)).toBe("New recurring cost");
  });

  it("leads with the stream when a whole stream moves", () => {
    expect(changeHeadline(at({ kind: "increased", category: "payroll", direction: "out" }))).toBe(
      "Payroll increased",
    );
    expect(changeHeadline(at({ kind: "decreased", category: "amex", direction: "out" }))).toBe(
      "Card spend decreased",
    );
  });

  it("distinguishes money coming in late from money going out late", () => {
    expect(changeHeadline(at({ kind: "moved", category: "currentAR", direction: "in", dayShift: 21 }))).toBe(
      "Payment slipped later",
    );
    expect(
      changeHeadline(at({ kind: "moved", category: "accountsPayable", direction: "out", dayShift: 14 })),
    ).toBe("Payment pushed out");
    expect(changeHeadline(at({ kind: "moved", category: "currentAR", direction: "in", dayShift: -9 }))).toBe(
      "Payment pulled forward",
    );
  });

  it("names a bill and an invoice, not just 'expense' and 'receipt'", () => {
    expect(changeHeadline(at({ category: "accountsPayable", direction: "out", afterCount: 1 }))).toBe("New bill");
    expect(changeHeadline(at({ category: "currentAR", direction: "in", afterCount: 1 }))).toBe("New invoice");
    expect(
      changeHeadline(at({ kind: "removed", category: "currentAR", direction: "in", beforeCount: 1 })),
    ).toBe("Invoice dropped");
  });

  it("calls a re-synced balance what it is", () => {
    expect(changeHeadline(at({ kind: "balance", category: undefined }))).toBe("Bank balance updated");
  });
});

describe("narrateChanges", () => {
  it("leads with the direction, then names the drivers", () => {
    const before = base({
      recurring: [{ id: "amex", category: "amex", amount: 40_000, frequency: "monthly", startDate: ANCHOR, memo: "AmEx" }],
    });
    const after = base({
      recurring: [{ id: "amex", category: "amex", amount: 49_000, frequency: "monthly", startDate: ANCHOR, memo: "AmEx" }],
      events: [{ id: "bill-new", category: "accountsPayable", amount: 62_500, date: "2026-09-15", memo: "Media buy" }],
    });
    const story = narrateChanges(diffForecasts(before, after), { since: "a week ago" });
    expect(story).toContain("worse off than a week ago");
    expect(story).toContain("card spend is up");
    expect(story).toContain("a new $62.5k bill landed");
  });

  it("collapses several edits to one category into a single clause", () => {
    // Three payroll bullets is right; "payroll is up, payroll is down, payroll
    // is up" in a sentence is not.
    const roster = (jane: number, amir: number) =>
      base({
        recurring: [
          { id: "s1", category: "payroll", amount: jane, frequency: "semimonthly", startDate: ANCHOR, memo: "Jane — salary" },
          { id: "s2", category: "payroll", amount: amir, frequency: "semimonthly", startDate: ANCHOR, memo: "Amir — salary" },
        ],
      });
    const report = diffForecasts(roster(6_000, 5_000), roster(7_000, 6_500));
    expect(report.changes).toHaveLength(2);
    const story = narrateChanges(report);
    expect(story).toContain("payroll is up");
    expect(story).toContain("net across 2 changes");
    expect(story.match(/payroll/g)).toHaveLength(1);
  });

  it("names the single line when a category has only one change", () => {
    const after = base({ events: [{ id: "bill-1", category: "accountsPayable", amount: 62_500, date: "2026-09-15", memo: "Media buy" }] });
    const story = narrateChanges(diffForecasts(base(), after));
    expect(story).toContain("a new $62.5k bill landed");
    expect(story).not.toContain("across 1 changes");
  });

  it("says so plainly when nothing moved", () => {
    expect(narrateChanges(diffForecasts(base(), base()))).toContain("essentially unchanged");
  });

  it("calls out timing shifts separately from cash impact", () => {
    const at = (date: string) => base({ events: [{ id: "inv-1", category: "currentAR", amount: 90_000, date, memo: "Acme" }] });
    const story = narrateChanges(diffForecasts(at("2026-08-03"), at("2026-08-24")));
    expect(story).toContain("a $90k payment shifted 21 days later without changing the total");
    expect(story).toContain("essentially unchanged");
  });

  it("reports a runway move in months", () => {
    const burning = (amount: number) =>
      base({
        recurring: [{ id: "burn", category: "operatingExpense", amount, frequency: "monthly", startDate: ANCHOR, memo: "Ops" }],
      });
    expect(narrateChanges(diffForecasts(burning(100_000), burning(130_000)))).toMatch(
      /Runway shortened by \d+\.\d months/,
    );
  });

  it("says outright when cash starts running out inside the horizon", () => {
    const after = base({
      recurring: [{ id: "burn", category: "operatingExpense", amount: 150_000, frequency: "monthly", startDate: ANCHOR, memo: "Ops" }],
    });
    expect(narrateChanges(diffForecasts(base(), after))).toContain("now runs out inside the horizon");
  });

  it("says outright when cash stops running out", () => {
    const before = base({
      recurring: [{ id: "burn", category: "operatingExpense", amount: 150_000, frequency: "monthly", startDate: ANCHOR, memo: "Ops" }],
    });
    expect(narrateChanges(diffForecasts(before, base()))).toContain("stays positive across the whole horizon");
  });
});
