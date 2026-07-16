import type { BankAccount, ForecastInput, ISODate } from "@engine/index.js";
import { todayISO } from "@/lib/format.js";
import { applyBalances, type PlaidAccountBalance } from "./map.js";

export interface ApplySummary {
  matched: number;
  unmatched: PlaidAccountBalance[];
}

type SetInput = (updater: (prev: ForecastInput) => ForecastInput) => void;

/** Fetch the last stored bank snapshot (no tokens). Null when nothing synced. */
async function fetchBankSnapshot(): Promise<{ asOf: ISODate; accounts: PlaidAccountBalance[] } | null> {
  const data = (await (await fetch("/api/bank/data", { cache: "no-store" })).json()) as {
    syncedAt: string | null;
    accounts: PlaidAccountBalance[];
  };
  if (!data.accounts?.length) return null;
  return { asOf: (data.syncedAt ?? todayISO()).slice(0, 10), accounts: data.accounts };
}

/**
 * Fetch the last snapshot and write it into the tracked accounts, matched by
 * last-four. Always applies (user-triggered). The summary is computed from
 * `currentAccounts` for display; the write goes through the functional
 * `setInput` so it lands on the authoritative latest state.
 */
export async function fetchAndApplyBankBalances(
  currentAccounts: BankAccount[],
  setInput: SetInput,
): Promise<ApplySummary> {
  const snap = await fetchBankSnapshot();
  if (!snap) return { matched: 0, unmatched: [] };
  const preview = applyBalances(currentAccounts, snap.accounts, snap.asOf);
  setInput((prev) => ({
    ...prev,
    bankAccounts: applyBalances(prev.bankAccounts, snap.accounts, snap.asOf).accounts,
  }));
  return { matched: preview.matched.length, unmatched: preview.unmatched };
}

/**
 * On-load auto-apply: refresh linked balances from the latest snapshot, but only
 * where it's strictly newer than what we have (so a more-recent manual edit is
 * never clobbered), and only write when something actually changed (so it
 * doesn't churn the shared workspace on every load). Returns true if it wrote.
 */
export async function autoApplyBankBalances(
  currentAccounts: BankAccount[],
  setInput: SetInput,
): Promise<boolean> {
  const snap = await fetchBankSnapshot();
  if (!snap) return false;
  const { matched } = applyBalances(currentAccounts, snap.accounts, snap.asOf, { onlyIfNewer: true });
  if (matched.length === 0) return false;
  setInput((prev) => ({
    ...prev,
    bankAccounts: applyBalances(prev.bankAccounts, snap.accounts, snap.asOf, { onlyIfNewer: true }).accounts,
  }));
  return true;
}
