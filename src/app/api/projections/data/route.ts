import { NextResponse } from "next/server";
import { getLastProjectionsSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last synced monthly operating profit, for the client to fold into the
 * tax calculation. Returns empty when nothing has synced yet, so the tax panel
 * falls back to hand-entered figures. No credentials, ever.
 */
export async function GET() {
  try {
    const last = await getLastProjectionsSync();
    return NextResponse.json({
      syncedAt: last?.syncedAt ?? null,
      tabTitle: last?.tabTitle ?? null,
      matchedLabel: last?.matchedLabel ?? null,
      year: last?.year ?? null,
      monthlyProfit: last?.monthlyProfit ?? {},
      missingMonths: last?.missingMonths ?? [],
      components: last?.components ?? [],
    });
  } catch {
    return NextResponse.json({
      syncedAt: null,
      tabTitle: null,
      matchedLabel: null,
      year: null,
      monthlyProfit: {},
      missingMonths: [],
      components: [],
    });
  }
}
