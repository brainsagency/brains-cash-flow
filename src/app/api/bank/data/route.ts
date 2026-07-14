import { NextResponse } from "next/server";
import { getLastBankSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last synced bank-account balances (for the client to apply to tracked
 * accounts by mask). Returns an empty list when nothing has synced yet. No
 * tokens, ever.
 */
export async function GET() {
  try {
    const lastSync = await getLastBankSync();
    return NextResponse.json({
      syncedAt: lastSync?.syncedAt ?? null,
      accounts: lastSync?.accounts ?? [],
    });
  } catch {
    return NextResponse.json({ syncedAt: null, accounts: [] });
  }
}
