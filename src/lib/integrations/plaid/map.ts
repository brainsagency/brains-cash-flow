/**
 * Plaid account → app bank-balance mapping.
 *
 * We track balances in `input.bankAccounts`, keyed for display by the last four
 * (`mask`). Plaid returns that same mask, so a sync matches each Plaid account
 * to an existing account by mask and updates its balance — no account ids to
 * reconcile. Unmatched Plaid accounts are returned too, so the UI can offer to
 * add them.
 */

import type { AccountBase } from "plaid";
import type { BankAccount, ISODate } from "@engine/index.js";

/** A normalized balance snapshot from Plaid (no tokens, safe to persist/return). */
export interface PlaidAccountBalance {
  accountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  /** Ledger balance (what the forecast uses as starting cash). */
  current: number | null;
  /** Available balance (after holds), if the institution reports it. */
  available: number | null;
  isoCurrencyCode: string | null;
}

export function mapPlaidAccount(a: AccountBase): PlaidAccountBalance {
  return {
    accountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type ?? null,
    subtype: a.subtype ?? null,
    current: a.balances.current ?? null,
    available: a.balances.available ?? null,
    isoCurrencyCode: a.balances.iso_currency_code ?? null,
  };
}

export function mapPlaidAccounts(accounts: AccountBase[]): PlaidAccountBalance[] {
  return accounts.map(mapPlaidAccount);
}

/** The balance to book as starting cash: prefer the ledger (current) balance. */
export function bookableBalance(b: PlaidAccountBalance): number | null {
  return b.current ?? b.available;
}

export interface BalanceMatch {
  account: BankAccount;
  synced: PlaidAccountBalance;
  newBalance: number;
}

export interface ApplyResult {
  accounts: BankAccount[];
  matched: BalanceMatch[];
  /** Plaid accounts with a real balance that didn't match any tracked mask. */
  unmatched: PlaidAccountBalance[];
}

/**
 * Apply synced balances to the tracked accounts, matching by mask. Matched
 * accounts get the fresh balance and `balanceAsOf = asOf`; everything else is
 * left untouched. Accounts with no mask, or a mask Plaid didn't return, are
 * skipped (nothing to match against) and stay as-is.
 */
export function applyBalances(
  accounts: BankAccount[],
  synced: PlaidAccountBalance[],
  asOf: ISODate,
): ApplyResult {
  const byMask = new Map<string, PlaidAccountBalance>();
  for (const s of synced) {
    if (s.mask && bookableBalance(s) != null) byMask.set(s.mask, s);
  }

  const matched: BalanceMatch[] = [];
  const usedMasks = new Set<string>();
  const next = accounts.map((acc) => {
    const s = acc.mask ? byMask.get(acc.mask) : undefined;
    const bal = s ? bookableBalance(s) : null;
    if (!s || bal == null) return acc;
    usedMasks.add(acc.mask!);
    const updated: BankAccount = { ...acc, beginningBalance: bal, balanceAsOf: asOf };
    matched.push({ account: updated, synced: s, newBalance: bal });
    return updated;
  });

  const unmatched = synced.filter(
    (s) => bookableBalance(s) != null && (!s.mask || !usedMasks.has(s.mask)),
  );

  return { accounts: next, matched, unmatched };
}
