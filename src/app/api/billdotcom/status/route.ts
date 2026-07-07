import { NextResponse } from "next/server";
import { getLastBillSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bill.com configuration + last-sync summary for the UI (never returns creds). */
export async function GET() {
  const configured = Boolean(
    process.env.BILLDOTCOM_DEV_KEY &&
      process.env.BILLDOTCOM_ORG_ID &&
      process.env.BILLDOTCOM_USERNAME &&
      process.env.BILLDOTCOM_PASSWORD,
  );
  let lastSync = null;
  try {
    lastSync = await getLastBillSync();
  } catch {
    /* storage unavailable — report safe state */
  }
  return NextResponse.json({
    configured,
    environment: process.env.BILLDOTCOM_ENVIRONMENT ?? "sandbox",
    lastSync: lastSync
      ? {
          syncedAt: lastSync.syncedAt,
          apCount: lastSync.apEvents.length,
          apTotal: lastSync.apTotal,
          reconciliation: lastSync.reconciliation,
        }
      : null,
  });
}
