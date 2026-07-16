import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron.js";
import { getBalances, PlaidAuthError } from "@/lib/integrations/plaid/client.js";
import { mapPlaidAccounts, type PlaidAccountBalance } from "@/lib/integrations/plaid/map.js";
import { appendLog, clearPlaidConnection, listPlaidConnections, saveBankSync } from "@/lib/integrations/store.js";

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

/** Pull live balances from every linked bank, merge, and store one snapshot. */
async function runBankSync() {
  const startedAt = new Date().toISOString();
  const conns = await listPlaidConnections();
  if (conns.length === 0) {
    return NextResponse.json({ error: "Bank is not connected." }, { status: 409 });
  }

  const accounts: PlaidAccountBalance[] = [];
  const needsReconnect: string[] = []; // institutions whose item expired
  const errors: string[] = [];
  for (const conn of conns) {
    const label = conn.institutionName ?? conn.itemId;
    try {
      accounts.push(...mapPlaidAccounts(await getBalances(conn.accessToken)));
    } catch (e) {
      if (e instanceof PlaidAuthError) {
        // Drop just this bank so the UI prompts a relink for it; keep the rest.
        await clearPlaidConnection(conn.itemId);
        needsReconnect.push(label);
      } else {
        errors.push(`${label}: ${(e as Error).message}`);
      }
    }
  }

  // Every linked bank failed — surface it rather than saving an empty snapshot.
  if (accounts.length === 0 && (needsReconnect.length > 0 || errors.length > 0)) {
    const finishedAt = new Date().toISOString();
    await appendLog({ source: "bank", startedAt, finishedAt, status: "error", message: [...needsReconnect.map((i) => `${i} expired`), ...errors].join("; ") });
    if (needsReconnect.length > 0) {
      return NextResponse.json(
        { error: `Reconnect needed: ${needsReconnect.join(", ")}.`, needsReconnect }, { status: 401 },
      );
    }
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  const result = { syncedAt: new Date().toISOString(), accounts };
  await saveBankSync(result);
  await appendLog({
    source: "bank",
    startedAt,
    finishedAt: result.syncedAt,
    status: "ok",
    accountCount: accounts.length,
    message: [...needsReconnect.map((i) => `${i} expired`), ...errors].join("; ") || undefined,
  });
  return NextResponse.json({
    ok: true,
    syncedAt: result.syncedAt,
    accountCount: accounts.length,
    ...(needsReconnect.length > 0 ? { needsReconnect } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  });
}
