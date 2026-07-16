import { NextResponse, type NextRequest } from "next/server";
import { exchangePublicToken, plaidConfigured } from "@/lib/integrations/plaid/client.js";
import { savePlaidConnection } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exchange the Link public token (from the browser widget) for a durable
 * access token and store the connection. The access token never leaves the
 * server — the client only ever sends the one-time public token.
 */
export async function POST(req: NextRequest) {
  if (!plaidConfigured()) {
    return NextResponse.json({ error: "Plaid is not configured." }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    public_token?: string;
    institution_name?: string;
  };
  if (!body.public_token) {
    return NextResponse.json({ error: "Missing public_token." }, { status: 400 });
  }
  try {
    const { accessToken, itemId } = await exchangePublicToken(body.public_token);
    await savePlaidConnection({
      accessToken,
      itemId,
      institutionName: body.institution_name,
      connectedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
