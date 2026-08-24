import { NextResponse } from "next/server";
import { sheetsConfigFromEnv } from "@/lib/integrations/sheets/client.js";
import { getLastProjectionsSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the projections feed is set up and when it last ran — drives the
 * "configure me" vs "synced 6h ago" state in the Taxes panel. Exposes the
 * service-account email (so the user knows who to share the sheet with) but
 * never the private key.
 */
export async function GET() {
  const cfg = sheetsConfigFromEnv();
  let last = null;
  try {
    last = await getLastProjectionsSync();
  } catch {
    /* store unavailable — report as never-synced rather than failing the page */
  }
  return NextResponse.json({
    configured: cfg !== null,
    serviceAccountEmail: cfg?.clientEmail ?? null,
    spreadsheetId: cfg?.spreadsheetId ?? null,
    configuredTab: cfg?.tabTitle ?? null,
    syncedAt: last?.syncedAt ?? null,
    tabTitle: last?.tabTitle ?? null,
    matchedLabel: last?.matchedLabel ?? null,
    components: last?.components ?? [],
    year: last?.year ?? null,
    monthCount: last ? Object.keys(last.monthlyProfit).length : 0,
    missingMonths: last?.missingMonths ?? [],
  });
}
