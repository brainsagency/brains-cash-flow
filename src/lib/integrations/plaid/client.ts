/**
 * Plaid client — bank-balance aggregation (server-only).
 *
 * Balances-only for now: we create a Link token, exchange the public token from
 * Link for a long-lived access token, and read live account balances via
 * `/accounts/get` (balances). No transactions are pulled.
 *
 * Config comes from env (never commit secrets):
 *  - PLAID_CLIENT_ID, PLAID_SECRET
 *  - PLAID_ENV: "sandbox" | "production" (Plaid retired the standalone
 *    "development" env; use production for live banks). Defaults to sandbox.
 *
 * Do not import from client components — this reads secrets.
 */

import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
} from "plaid";

/** Thrown when the linked item needs the user to re-authenticate (relink). */
export class PlaidAuthError extends Error {}

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaidEnv(): string {
  return process.env.PLAID_ENV ?? "sandbox";
}

function plaidClient(): PlaidApi {
  const env = plaidEnv();
  const basePath =
    (PlaidEnvironments as Record<string, string>)[env] ?? PlaidEnvironments.sandbox;
  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  });
  return new PlaidApi(configuration);
}

/**
 * Products requested at Link time. Plaid won't accept `balance` on its own — it
 * auto-initializes alongside any other product, and we only ever call
 * balances. So we request `transactions` (the most commonly
 * enabled product) purely to unlock balances; no transactions are pulled.
 * Override with `PLAID_PRODUCTS` (comma-separated) to match whatever product is
 * enabled on your Plaid account, e.g. `PLAID_PRODUCTS=auth`.
 */
function linkProducts(): Products[] {
  const raw = process.env.PLAID_PRODUCTS;
  const valid = new Set(Object.values(Products) as string[]);
  const chosen = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => valid.has(s) && s !== "balance") as Products[];
  return chosen.length ? chosen : [Products.Transactions];
}

/**
 * Create a Link token for the browser widget.
 *
 * `PLAID_REDIRECT_URI` is required for OAuth institutions (Chase, Wells Fargo,
 * Capital One, …): Plaid sends the user to the bank and back to this exact URL,
 * which must be registered under Allowed redirect URIs in the Plaid dashboard.
 * When unset, only non-OAuth banks will complete.
 */
export async function createLinkToken(): Promise<string> {
  const client = plaidClient();
  const redirectUri = process.env.PLAID_REDIRECT_URI || undefined;
  try {
    const resp = await client.linkTokenCreate({
      user: { client_user_id: "brains-cashflow" },
      client_name: "Brains Cash Flow",
      products: linkProducts(),
      country_codes: [CountryCode.Us],
      language: "en",
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });
    return resp.data.link_token;
  } catch (e) {
    throw asPlaidError(e);
  }
}

/** Exchange a Link public token for a durable access token + item id. */
export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const client = plaidClient();
  try {
    const resp = await client.itemPublicTokenExchange({ public_token: publicToken });
    return { accessToken: resp.data.access_token, itemId: resp.data.item_id };
  } catch (e) {
    throw asPlaidError(e);
  }
}

/**
 * Balances for every account on the linked item.
 *
 * Uses `/accounts/get` (not `/accounts/balance/get`): it returns the same
 * accounts with their `balances`, works with any product (e.g. Transactions),
 * and does NOT require the separate Balance product to be authorized. It
 * returns Plaid's most-recent cached balances — fine for a daily-synced
 * forecast. Switch to `accountsBalanceGet` only if the Balance product is
 * enabled and you need a forced real-time pull.
 */
export async function getBalances(accessToken: string): Promise<AccountBase[]> {
  const client = plaidClient();
  try {
    const resp = await client.accountsGet({ access_token: accessToken });
    return resp.data.accounts;
  } catch (e) {
    throw asPlaidError(e);
  }
}

/**
 * Normalize a Plaid SDK/Axios error. Surfaces Plaid's `error_message` when
 * present, and maps a login-required item to PlaidAuthError so the caller can
 * drop the connection and prompt a relink.
 */
function asPlaidError(e: unknown): Error {
  const data = (e as { response?: { data?: { error_code?: string; error_message?: string } } })
    ?.response?.data;
  const code = data?.error_code;
  const message = data?.error_message ?? (e as Error).message ?? "Plaid request failed";
  if (code === "ITEM_LOGIN_REQUIRED") return new PlaidAuthError(message);
  return new Error(message);
}
