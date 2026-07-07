import { NextResponse } from "next/server";
import { getLastBillSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Last synced Bill.com AP events (feeds the forecast). Empty until synced. */
export async function GET() {
  try {
    const lastSync = await getLastBillSync();
    return NextResponse.json({
      syncedAt: lastSync?.syncedAt ?? null,
      apEvents: lastSync?.apEvents ?? [],
      reconciliation: lastSync?.reconciliation ?? null,
    });
  } catch {
    return NextResponse.json({ syncedAt: null, apEvents: [], reconciliation: null });
  }
}
