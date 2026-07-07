import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl, qboConfig } from "@/lib/integrations/qbo/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kick off the OAuth consent flow: redirect the user to Intuit. */
export async function GET(_req: NextRequest) {
  let cfg;
  try {
    cfg = qboConfig();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(await buildAuthorizeUrl(cfg, state));
  // CSRF guard: verify this on callback.
  res.cookies.set("qbo_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
