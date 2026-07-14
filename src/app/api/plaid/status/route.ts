import { NextResponse } from "next/server";
import { plaidConfigured, plaidEnv } from "@/lib/integrations/plaid/client.js";
import { getLastBankSync, getPlaidConnection } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection + last-bank-sync summary for the UI (never returns tokens). */
export async function GET() {
  const configured = plaidConfigured();
  try {
    const conn = await getPlaidConnection();
    const lastSync = await getLastBankSync();
    return NextResponse.json({
      configured,
      connected: Boolean(conn),
      environment: plaidEnv(),
      connectedAt: conn?.connectedAt ?? null,
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
      connectedAt: null,
      lastSync: null,
      storageError: (e as Error).message,
    });
  }
}
