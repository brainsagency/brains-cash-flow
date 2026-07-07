import { NextResponse } from "next/server";
import { getConnection, getLastSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection + last-sync summary for the UI (never returns tokens). */
export async function GET() {
  const configured = Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_REDIRECT_URI);
  let conn = null;
  let lastSync = null;
  try {
    conn = await getConnection();
    lastSync = await getLastSync();
  } catch (e) {
    // Storage unavailable (e.g. schema not yet created) — report a safe state.
    return NextResponse.json({
      configured,
      connected: false,
      environment: process.env.QBO_ENVIRONMENT ?? "sandbox",
      realmId: null,
      lastSync: null,
      storageError: (e as Error).message,
    });
  }
  return NextResponse.json({
    configured,
    connected: Boolean(conn),
    environment: process.env.QBO_ENVIRONMENT ?? "sandbox",
    realmId: conn?.realmId ?? null,
    lastSync: lastSync
      ? {
          syncedAt: lastSync.syncedAt,
          arCount: lastSync.arEvents.length,
          apCount: lastSync.apValidationEvents.length,
          arTotal: lastSync.arTotal,
          apTotal: lastSync.apTotal,
        }
      : null,
  });
}
