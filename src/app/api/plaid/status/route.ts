import { NextResponse } from "next/server";
import { plaidConfigured, plaidEnv } from "@/lib/integrations/plaid/client.js";
import { getLastBankSync, listPlaidConnections } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection + last-bank-sync summary for the UI (never returns tokens). */
export async function GET() {
  const configured = plaidConfigured();
  try {
    const conns = await listPlaidConnections();
    const lastSync = await getLastBankSync();
    return NextResponse.json({
      configured,
      connected: conns.length > 0,
      environment: plaidEnv(),
      institutions: conns
        .map((c) => ({
          itemId: c.itemId,
          name: c.institutionName ?? "Bank",
          connectedAt: c.connectedAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lastSync: lastSync
        ? { syncedAt: lastSync.syncedAt, accountCount: lastSync.accounts.length }
        : null,
    });
  } catch (e) {
    // Storage unavailable (e.g. schema not yet created) — report a safe state.
    return NextResponse.json({
      configured,
      connected: false,
      environment: plaidEnv(),
      institutions: [],
      lastSync: null,
      storageError: (e as Error).message,
    });
  }
}
