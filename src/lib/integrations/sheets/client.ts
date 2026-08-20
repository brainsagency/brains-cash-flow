/**
 * Google Sheets API v4 client, authenticated as a service account.
 *
 * Hand-rolled with `fetch` + node `crypto` rather than pulling in `googleapis`
 * (which is enormous for the two calls we make), matching how the QBO client is
 * built. Read-only scope — the same guardrail as every other feed here.
 *
 * A service account (not the user's Google SSO token) is deliberate: the
 * nightly cron runs with nobody signed in, so the credential has to belong to
 * the app, not to a person. Setup is in `docs/PROJECTIONS.md`.
 *
 * Server-only. Do not import from client components.
 */

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** Thrown when Google rejects our credentials or denies access to the sheet. */
export class SheetsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetsAuthError";
  }
}

export interface SheetsConfig {
  clientEmail: string;
  /** PEM private key. Vercel env vars keep newlines as "\n", so we unescape. */
  privateKey: string;
  spreadsheetId: string;
  /** Tab to read. Omit to auto-pick (see `resolveTab`). */
  tabTitle?: string;
}

/**
 * Read config from the environment. Returns null when the integration hasn't
 * been set up, so callers can report "not configured" instead of throwing —
 * every integration here is independently toggleable.
 */
export function sheetsConfigFromEnv(): SheetsConfig | null {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.PROJECTIONS_SHEET_ID;
  if (!clientEmail || !rawKey || !spreadsheetId) return null;
  return {
    clientEmail,
    privateKey: rawKey.replace(/\\n/g, "\n"),
    spreadsheetId,
    tabTitle: process.env.PROJECTIONS_SHEET_TAB || undefined,
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint a short-lived access token via the JWT-bearer flow: sign a claim set
 * with the service account's private key and trade it for a bearer token.
 */
export async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    signature = base64url(signer.sign(cfg.privateKey));
  } catch (e) {
    // Almost always a mangled PEM (missing newlines, or the quotes kept).
    throw new SheetsAuthError(
      `Could not sign with GOOGLE_SHEETS_PRIVATE_KEY — check the PEM is intact: ${(e as Error).message}`,
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new SheetsAuthError(
      `Google token request failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new SheetsAuthError("Google token response had no access_token.");
  return body.access_token;
}

async function apiGet<T>(cfg: SheetsConfig, token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${cfg.spreadsheetId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new SheetsAuthError(
      `Google denied access to the spreadsheet (${res.status}). Share it with ${cfg.clientEmail} as a Viewer.`,
    );
  }
  if (res.status === 404) {
    throw new Error(`Spreadsheet ${cfg.spreadsheetId} not found — check PROJECTIONS_SHEET_ID.`);
  }
  if (!res.ok) throw new Error(`Google Sheets API failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SheetTab {
  title: string;
  sheetId: number;
}

export async function listTabs(cfg: SheetsConfig, token: string): Promise<SheetTab[]> {
  const doc = await apiGet<{ sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> }>(
    cfg,
    token,
    "?fields=sheets.properties.title,sheets.properties.sheetId",
  );
  return (doc.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? "", sheetId: s.properties?.sheetId ?? -1 }))
    .filter((t) => t.title !== "");
}

/**
 * Pick which tab to read: the configured title if it exists, else the tab whose
 * title contains the target year, else the first tab. The projections workbook
 * keeps a tab per year, so year-matching is the useful default and means the
 * sync keeps working in January without a config change.
 */
export function resolveTab(tabs: SheetTab[], configured: string | undefined, year: number): SheetTab | null {
  if (tabs.length === 0) return null;
  if (configured) {
    const exact = tabs.find((t) => t.title === configured);
    if (exact) return exact;
    const loose = tabs.find((t) => t.title.trim().toLowerCase() === configured.trim().toLowerCase());
    if (loose) return loose;
  }
  return tabs.find((t) => t.title.includes(String(year))) ?? tabs[0]!;
}

/** Raw cell values for a tab. Unformatted so money comes back as numbers. */
export async function getTabValues(
  cfg: SheetsConfig,
  token: string,
  tabTitle: string,
): Promise<unknown[][]> {
  const range = encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'`);
  const doc = await apiGet<{ values?: unknown[][] }>(
    cfg,
    token,
    `/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  );
  return doc.values ?? [];
}
