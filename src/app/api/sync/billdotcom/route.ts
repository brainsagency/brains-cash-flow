import { NextResponse, type NextRequest } from "next/server";
import { billConfig, listBills, listVendorNames, login } from "@/lib/integrations/billdotcom/client.js";
import { mapBills } from "@/lib/integrations/billdotcom/map.js";
import { reconcileAp } from "@/lib/integrations/billdotcom/reconcile.js";
import { appendLog, getLastSync, saveBillSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull AP from Bill.com (the AP source of truth) and reconcile it against the
 * QBO Bills validation set from the last QuickBooks sync.
 */
export async function POST(_req: NextRequest) {
  const startedAt = new Date().toISOString();
  let cfg;
  try {
    cfg = billConfig();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  try {
    const sessionId = await login(cfg);
    const anchor = new Date().toISOString().slice(0, 10);
    const [bills, vendorNames] = await Promise.all([
      listBills(cfg, sessionId),
      listVendorNames(cfg, sessionId).catch(() => ({}) as Record<string, string>),
    ]);

    const apEvents = mapBills(bills, anchor, vendorNames);
    const apTotal = apEvents.reduce((s, e) => s + e.amount, 0);

    // Cross-check vs QuickBooks Bills (validation set from the QBO sync).
    const qboSync = await getLastSync().catch(() => null);
    const reconciliation = qboSync ? reconcileAp(apEvents, qboSync.apValidationEvents) : null;

    const result = { syncedAt: new Date().toISOString(), anchor, apEvents, apTotal, reconciliation };
    await saveBillSync(result);
    await appendLog({
      source: "billdotcom",
      startedAt,
      finishedAt: result.syncedAt,
      status: "ok",
      apCount: apEvents.length,
    });

    return NextResponse.json({ ok: true, syncedAt: result.syncedAt, apCount: apEvents.length, apTotal, reconciliation });
  } catch (e) {
    const message = (e as Error).message;
    await appendLog({ source: "billdotcom", startedAt, finishedAt: new Date().toISOString(), status: "error", message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
