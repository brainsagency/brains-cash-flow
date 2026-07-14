import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron.js";
import { getBalances, PlaidAuthError } from "@/lib/integrations/plaid/client.js";
import { mapPlaidAccounts } from "@/lib/integrations/plaid/map.js";
import { appendLog, clearPlaidConnection, getPlaidConnection, saveBankSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** UI-triggered sync (page is already behind the auth gate). */
export function POST(_req: NextRequest) {
  return runBankSync();
}

/** Cron-triggered sync (Vercel Cron issues GETs with the cron bearer). */
export function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runBankSync();
}

/** Pull live account balances from Plaid and store the snapshot. */
async function runBankSync() {
  const startedAt = new Date().toISOString();
  const conn = await getPlaidConnection();
  if (!conn) {
    return NextResponse.json({ error: "Bank is not connected." }, { status: 409 });
  }
  try {
    const accounts = mapPlaidAccounts(await getBalances(conn.accessToken));
    const result = { syncedAt: new Date().toISOString(), accounts };
    await saveBankSync(result);
    await appendLog({
      source: "bank",
      startedAt,
      finishedAt: result.syncedAt,
      status: "ok",
      accountCount: accounts.length,
    });
    return NextResponse.json({ ok: true, syncedAt: result.syncedAt, accountCount: accounts.length });
  } catch (e) {
    const message = (e as Error).message;
    await appendLog({ source: "bank", startedAt, finishedAt: new Date().toISOString(), status: "error", message });
    // Item needs re-auth: drop the connection so the UI prompts a relink.
    if (e instanceof PlaidAuthError) {
      await clearPlaidConnection();
      return NextResponse.json(
        { error: "Bank connection expired — please reconnect.", needsReconnect: true },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
