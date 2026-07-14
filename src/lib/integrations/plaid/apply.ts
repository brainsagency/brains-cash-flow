import type { BankAccount, ForecastInput } from "@engine/index.js";
import { todayISO } from "@/lib/format.js";
import { applyBalances, type PlaidAccountBalance } from "./map.js";

export interface ApplySummary {
  matched: number;
  unmatched: PlaidAccountBalance[];
}

/**
 * Fetch the last stored bank snapshot and write it into the tracked accounts,
 * matched by last-four. The summary is computed from `currentAccounts` (the
 * render-time snapshot) for display, while the actual write goes through the
 * functional `setInput` so it's applied against the authoritative latest state.
 */
export async function fetchAndApplyBankBalances(
  currentAccounts: BankAccount[],
  setInput: (updater: (prev: ForecastInput) => ForecastInput) => void,
): Promise<ApplySummary> {
  const data = (await (await fetch("/api/bank/data", { cache: "no-store" })).json()) as {
    syncedAt: string | null;
    accounts: PlaidAccountBalance[];
  };
  const asOf = (data.syncedAt ?? todayISO()).slice(0, 10);
  const preview = applyBalances(currentAccounts, data.accounts, asOf);
  setInput((prev) => ({
    ...prev,
    bankAccounts: applyBalances(prev.bankAccounts, data.accounts, asOf).accounts,
  }));
  return { matched: preview.matched.length, unmatched: preview.unmatched };
}
