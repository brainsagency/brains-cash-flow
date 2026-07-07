import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron.js";
import { billConfig, listBills, login } from "@/lib/integrations/billdotcom/client.js";
import { mapBills } from "@/lib/integrations/billdotcom/map.js";
import { reconcileAp } from "@/lib/integrations/billdotcom/reconcile.js";
import { appendLog, getLastSync, saveBillSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Production sync pages through every bill/vendor (~1-2 min observed).
export const maxDuration = 300;

/** UI-triggered sync (page is already behind the password gate). */
export function POST(_req: NextRequest) {
  return runBillSync();
}

/** Cron-triggered sync (Vercel Cron issues GETs with the cron bearer). */
export function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runBillSync();
}

/**
 * Pull AP from Bill.com (the AP source of truth) and reconcile it against the
 * QBO Bills validation set from the last QuickBooks sync.
 */
async function runBillSync() {
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
    // Bills carry vendorName directly — no separate vendors call needed.
    const bills = await listBills(cfg, sessionId);

    const apEvents = mapBills(bills, anchor);
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
