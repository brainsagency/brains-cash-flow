/**
 * Access control for Google SSO: an explicit email allowlist read from the
 * `AUTH_ALLOWED_EMAILS` env var (comma-separated, case-insensitive). Edge-safe
 * (env only) so it can run in middleware.
 *
 * Fails closed: if the allowlist is empty/unset, nobody is allowed. Set the env
 * var before the gate is useful.
 */

export function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  if (list.length === 0) return false; // fail closed — no allowlist, no access
  return list.includes(email.toLowerCase());
}
