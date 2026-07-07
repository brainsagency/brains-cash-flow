import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, qboConfig } from "@/lib/integrations/qbo/client.js";
import { saveConnection } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth redirect target: exchange the code for tokens and store the connection. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("qbo_oauth_state")?.value;

  const back = (status: string) => NextResponse.redirect(new URL(`/?qbo=${status}`, req.url));

  if (url.searchParams.get("error")) return back("denied");
  if (!code || !realmId) return back("error");
  if (!state || state !== cookieState) {
    return NextResponse.json({ error: "OAuth state mismatch" }, { status: 400 });
  }

  try {
    const cfg = qboConfig();
    const tokens = await exchangeCode(cfg, code);
    await saveConnection({
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      connectedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const res = back("connected");
  res.cookies.delete("qbo_oauth_state");
  return res;
}
