import { NextResponse, type NextRequest } from "next/server";

/**
 * Guard for cron-invoked GET endpoints. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 * Returns a 401 response to send back, or null when the request is allowed.
 *
 * If CRON_SECRET is unset the request is allowed — the middleware password
 * gate (when enabled) is then the only protection, which matches local dev.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
