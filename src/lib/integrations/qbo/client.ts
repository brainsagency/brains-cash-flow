/**
 * QuickBooks Online OAuth2 + Accounting API client.
 *
 * Pure-ish HTTP module (no storage): build the authorize URL, exchange/refresh
 * tokens, and run queries. All secrets come in via `QboConfig`; storage of
 * tokens lives in the store layer. Hand-rolled with fetch to stay dependency-
 * light and transparent.
 *
 * Docs: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 */

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export type QboEnvironment = "sandbox" | "production";

/**
 * Thrown when Intuit rejects our credentials (expired/revoked refresh token,
 * or a 401 on a data call) — signals the user must reconnect, as opposed to a
 * transient error worth leaving the connection intact for.
 */
export class QboAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QboAuthError";
  }
}

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  environment: QboEnvironment;
  redirectUri: string;
}

export interface QboTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (~3600)
  x_refresh_token_expires_in: number; // seconds
  token_type: string;
}

/** Read config from env; throws a clear error if anything is missing. */
export function qboConfig(): QboConfig {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment = (process.env.QBO_ENVIRONMENT ?? "sandbox") as QboEnvironment;
  const missing = [
    ["QBO_CLIENT_ID", clientId],
    ["QBO_CLIENT_SECRET", clientSecret],
    ["QBO_REDIRECT_URI", redirectUri],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`QuickBooks is not configured. Missing env: ${missing.join(", ")}`);
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri!, environment };
}

export function apiBase(environment: QboEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/** Step 1: URL to send the user to for consent. */
export function buildAuthorizeUrl(cfg: QboConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuth(cfg: QboConfig): string {
  return "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function tokenRequest(cfg: QboConfig, body: URLSearchParams): Promise<QboTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const body = await res.text();
    // 400 (invalid_grant) / 401 → refresh token expired or revoked: reconnect.
    if (res.status === 400 || res.status === 401) {
      throw new QboAuthError(`QBO auth failed (${res.status}): ${body}`);
    }
    throw new Error(`QBO token request failed (${res.status}): ${body}`);
  }
  return (await res.json()) as QboTokens;
}

/** Step 2: exchange the authorization code for tokens. */
export function exchangeCode(cfg: QboConfig, code: string): Promise<QboTokens> {
  return tokenRequest(
    cfg,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }),
  );
}

/**
 * Refresh the access token. The refresh token ROTATES — the response carries a
 * new refresh_token that MUST be persisted for the next call.
 */
export function refreshTokens(cfg: QboConfig, refreshToken: string): Promise<QboTokens> {
  return tokenRequest(
    cfg,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

export interface QboQueryResponse {
  QueryResponse: {
    Invoice?: unknown[];
    Bill?: unknown[];
    maxResults?: number;
    startPosition?: number;
    totalCount?: number;
  };
}

/** Run a QBO SQL-like query against a company (realm). */
export async function queryQbo(
  cfg: QboConfig,
  realmId: string,
  accessToken: string,
  sql: string,
): Promise<QboQueryResponse["QueryResponse"]> {
  const url = `${apiBase(cfg.environment)}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) throw new QboAuthError(`QBO query unauthorized (401): ${body}`);
    throw new Error(`QBO query failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as QboQueryResponse;
  return json.QueryResponse ?? {};
}
