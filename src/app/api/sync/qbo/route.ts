import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron.js";
import { qboConfig, queryQbo, refreshTokens } from "@/lib/integrations/qbo/client.js";
import { mapBills, mapInvoices, type QboBill, type QboInvoice } from "@/lib/integrations/qbo/map.js";
import { appendLog, getConnection, saveConnection, saveSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_SKEW_MS = 60_000; // refresh a minute before expiry

/** UI-triggered sync (page is already behind the password gate). */
export function POST(_req: NextRequest) {
  return runQboSync();
}

/** Cron-triggered sync (Vercel Cron issues GETs with the cron bearer). */
export function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runQboSync();
}

/** Pull AR (Invoices, for the forecast) + AP (Bills, for validation) from QBO. */
async function runQboSync() {
  const startedAt = new Date().toISOString();
  const conn = await getConnection();
  if (!conn) {
    return NextResponse.json({ error: "QuickBooks is not connected." }, { status: 409 });
  }

  try {
    const cfg = qboConfig();
    let { accessToken, refreshToken, accessTokenExpiresAt } = conn;

    // Refresh if the access token is expired/expiring; persist the rotated refresh token.
    if (Date.now() > accessTokenExpiresAt - REFRESH_SKEW_MS) {
      const t = await refreshTokens(cfg, refreshToken);
      accessToken = t.access_token;
      refreshToken = t.refresh_token;
      accessTokenExpiresAt = Date.now() + t.expires_in * 1000;
      await saveConnection({ ...conn, accessToken, refreshToken, accessTokenExpiresAt });
    }

    const anchor = new Date().toISOString().slice(0, 10);
    const [invResp, billResp] = await Promise.all([
      queryQbo(cfg, conn.realmId, accessToken, "SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 1000"),
      queryQbo(cfg, conn.realmId, accessToken, "SELECT * FROM Bill WHERE Balance > '0' MAXRESULTS 1000"),
    ]);

    const arEvents = mapInvoices((invResp.Invoice ?? []) as QboInvoice[], anchor);
    const apValidationEvents = mapBills((billResp.Bill ?? []) as QboBill[], anchor);
    const arTotal = arEvents.reduce((s, e) => s + e.amount, 0);
    const apTotal = apValidationEvents.reduce((s, e) => s + e.amount, 0);

    const result = { syncedAt: new Date().toISOString(), anchor, arEvents, apValidationEvents, arTotal, apTotal };
    await saveSync(result);
    await appendLog({
      source: "qbo",
      startedAt,
      finishedAt: result.syncedAt,
      status: "ok",
      arCount: arEvents.length,
      apCount: apValidationEvents.length,
    });

    return NextResponse.json({
      ok: true,
      syncedAt: result.syncedAt,
      arCount: arEvents.length,
      apCount: apValidationEvents.length,
      arTotal,
      apTotal,
    });
  } catch (e) {
    const message = (e as Error).message;
    await appendLog({ source: "qbo", startedAt, finishedAt: new Date().toISOString(), status: "error", message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
