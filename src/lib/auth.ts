/**
 * Temporary shared-password gate. Edge-safe (only Web Crypto + env), so it can
 * run in middleware. The cookie stores a hash of the password, never the
 * password itself. This is a stopgap until real Supabase Auth (SSO) lands.
 */

export const COOKIE_NAME = "brains_gate";
const SALT = "brains-cashflow::v1::";

/** SHA-256 hex of the salted password — used as the cookie/session token. */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(SALT + password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The token a valid cookie must match, or null if the gate is disabled. */
export async function expectedToken(): Promise<string | null> {
  const pw = process.env.APP_PASSWORD;
  return pw ? tokenFor(pw) : null;
}
