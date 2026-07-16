import { NextResponse, type NextRequest } from "next/server";
import { removeItem } from "@/lib/integrations/plaid/client.js";
import { clearPlaidConnection, listPlaidConnections } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disconnect one linked bank: invalidate the item at Plaid, then drop it. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { itemId?: string };
  if (!body.itemId) {
    return NextResponse.json({ error: "Missing itemId." }, { status: 400 });
  }
  try {
    const conn = (await listPlaidConnections()).find((c) => c.itemId === body.itemId);
    if (conn) {
      // Best-effort: invalidate at Plaid, but still drop it locally either way.
      try {
        await removeItem(conn.accessToken);
      } catch {
        /* ignore — remove locally regardless */
      }
      await clearPlaidConnection(conn.itemId);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
