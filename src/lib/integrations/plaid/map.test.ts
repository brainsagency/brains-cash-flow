import { describe, expect, it } from "vitest";
import type { BankAccount } from "@engine/index.js";
import { applyBalances, type PlaidAccountBalance } from "./map.js";

function bal(p: Partial<PlaidAccountBalance>): PlaidAccountBalance {
  return {
    accountId: p.accountId ?? "acc",
    name: p.name ?? "Account",
    officialName: p.officialName ?? null,
    mask: p.mask ?? null,
    type: p.type ?? "depository",
    subtype: p.subtype ?? "checking",
    current: p.current ?? null,
    available: p.available ?? null,
    isoCurrencyCode: p.isoCurrencyCode ?? "USD",
  };
}

const ASOF = "2026-07-13";

describe("applyBalances", () => {
  const accounts: BankAccount[] = [
    { id: "chk", name: "Checking", mask: "0377", beginningBalance: 100, balanceAsOf: "2026-07-01" },
    { id: "sav", name: "Savings", mask: "1535", beginningBalance: 200, balanceAsOf: "2026-07-01" },
    { id: "nom", name: "No mask", beginningBalance: 300, balanceAsOf: "2026-07-01" },
  ];

  it("updates matched accounts by mask and stamps the as-of date", () => {
    const { accounts: next, matched } = applyBalances(
      accounts,
      [bal({ mask: "0377", current: 380_944.6 })],
      ASOF,
    );
    const chk = next.find((a) => a.id === "chk")!;
    expect(chk.beginningBalance).toBeCloseTo(380_944.6, 2);
    expect(chk.balanceAsOf).toBe(ASOF);
    expect(matched).toHaveLength(1);
    // Untouched accounts keep their old balance and date.
    expect(next.find((a) => a.id === "sav")!.beginningBalance).toBe(200);
    expect(next.find((a) => a.id === "sav")!.balanceAsOf).toBe("2026-07-01");
  });

  it("prefers current (ledger) balance, falling back to available", () => {
    const { accounts: next } = applyBalances(accounts, [bal({ mask: "1535", current: null, available: 250 })], ASOF);
    expect(next.find((a) => a.id === "sav")!.beginningBalance).toBe(250);
  });

  it("reports Plaid accounts that matched no tracked mask as unmatched", () => {
    const { unmatched, matched } = applyBalances(
      accounts,
      [bal({ name: "HYSA", mask: "9999", current: 5_000 })],
      ASOF,
    );
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.mask).toBe("9999");
  });

  it("skips balances with no bookable amount", () => {
    const { matched, unmatched } = applyBalances(accounts, [bal({ mask: "0377", current: null, available: null })], ASOF);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(0); // nothing to book, so not surfaced
  });

  it("onlyIfNewer skips accounts whose balance is same-day or newer than the snapshot", () => {
    const accts: BankAccount[] = [
      { id: "chk", name: "Checking", mask: "0377", beginningBalance: 100, balanceAsOf: "2026-07-13" }, // same day → skip
      { id: "sav", name: "Savings", mask: "1535", beginningBalance: 200, balanceAsOf: "2026-07-10" }, // older → apply
      { id: "shr", name: "Shareholder", mask: "8987", beginningBalance: 300, balanceAsOf: "2026-07-20" }, // newer → skip
    ];
    const snap = [bal({ mask: "0377", current: 111 }), bal({ mask: "1535", current: 222 }), bal({ mask: "8987", current: 333 })];
    const { accounts: next, matched } = applyBalances(accts, snap, "2026-07-13", { onlyIfNewer: true });
    expect(matched.map((m) => m.account.id)).toEqual(["sav"]); // only the older one updates
    expect(next.find((a) => a.id === "chk")!.beginningBalance).toBe(100); // manual same-day edit preserved
    expect(next.find((a) => a.id === "sav")!.beginningBalance).toBe(222);
    expect(next.find((a) => a.id === "shr")!.beginningBalance).toBe(300); // newer manual edit preserved
  });

  it("onlyIfNewer still applies to an account with no date", () => {
    const accts: BankAccount[] = [{ id: "chk", name: "Checking", mask: "0377", beginningBalance: 0 }];
    const { matched } = applyBalances(accts, [bal({ mask: "0377", current: 500 })], "2026-07-13", { onlyIfNewer: true });
    expect(matched).toHaveLength(1);
  });

  it("never matches a tracked account that has no mask", () => {
    // A Plaid account with no mask can't be keyed; the maskless tracked account stays put.
    const { accounts: next, unmatched } = applyBalances(accounts, [bal({ mask: null, current: 999 })], ASOF);
    expect(next.find((a) => a.id === "nom")!.beginningBalance).toBe(300);
    expect(unmatched).toHaveLength(1);
  });
});
