import { NextResponse } from "next/server";
import { createLinkToken, plaidConfigured } from "@/lib/integrations/plaid/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mint a short-lived Link token for the browser widget. */
export async function POST() {
  if (!plaidConfigured()) {
    return NextResponse.json({ error: "Plaid is not configured." }, { status: 409 });
  }
  try {
    const linkToken = await createLinkToken();
    return NextResponse.json({ linkToken });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
