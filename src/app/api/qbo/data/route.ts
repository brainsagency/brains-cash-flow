import { NextResponse } from "next/server";
import { getLastSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last synced AR events (for the forecast) + AP validation events.
 * Returns empty arrays when nothing has synced yet. No tokens, ever.
 */
export async function GET() {
  try {
    const lastSync = await getLastSync();
    return NextResponse.json({
      syncedAt: lastSync?.syncedAt ?? null,
      arEvents: lastSync?.arEvents ?? [],
      apValidationEvents: lastSync?.apValidationEvents ?? [],
      mcReimbursedThrough: lastSync?.mcReimbursedThrough ?? null,
    });
  } catch {
    // Storage unavailable — return empty so the app stays on manual data.
    return NextResponse.json({ syncedAt: null, arEvents: [], apValidationEvents: [], mcReimbursedThrough: null });
  }
}

