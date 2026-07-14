import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/integrations/supabase.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shared app workspace: the manual forecast layer, scenarios, and AP
 * adjustments, stored as one document so the whole team sees the same
 * assumptions. Last write wins (single finance user in practice). The client
 * falls back to localStorage when this returns 503 (Supabase missing/table
 * not created), so cloud storage is additive, never a hard dependency.
 */

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "cloud storage not configured" }, { status: 503 });
  }
  const { data, error } = await supabaseAdmin().from("app_state").select("*").eq("id", "default").maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json({
    input: data?.input ?? null,
    scenarios: data?.scenarios ?? [],
    // Reuse the existing ap_adjustments column for all synced-item adjustments
    // (keys are namespaced: qbo-inv-… / bill-…), so no schema migration.
    adjustments: data?.ap_adjustments ?? {},
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PUT(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "cloud storage not configured" }, { status: 503 });
  }
  let body: {
    input?: { anchorDate?: string; bankAccounts?: unknown[] };
    scenarios?: unknown[];
    adjustments?: Record<string, unknown>;
    /**
     * The `updated_at` the client last saw. Used as an optimistic-concurrency
     * check: the write only lands if the stored row still matches, so a stale
     * background tab can't clobber a fresher save from another session. Omit
     * (null) for a first-ever / adoption write, which upserts unconditionally.
     */
    baseUpdatedAt?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Minimal shape check so a buggy client can't wipe the workspace.
  if (!body.input?.anchorDate || !Array.isArray(body.input.bankAccounts)) {
    return NextResponse.json({ error: "input.anchorDate and input.bankAccounts required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const row = {
    id: "default",
    input: body.input,
    scenarios: body.scenarios ?? [],
    ap_adjustments: body.adjustments ?? {},
    updated_at: now,
  };
  const base = body.baseUpdatedAt;

  // No base → first write / adoption: last-write-wins upsert (legacy behavior).
  if (!base) {
    const { error } = await sb.from("app_state").upsert(row);
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ ok: true, updatedAt: now });
  }

  // Compare-and-swap: the WHERE on updated_at makes this atomic — the update
  // touches 0 rows if another session wrote since the client last read.
  const { data: upd, error: updErr } = await sb
    .from("app_state")
    .update(row)
    .eq("id", "default")
    .eq("updated_at", base)
    .select("updated_at");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 503 });
  if (upd && upd.length > 0) return NextResponse.json({ ok: true, updatedAt: now });

  // 0 rows updated: either the row was changed under us (conflict) or it's gone.
  const { data: cur, error: curErr } = await sb
    .from("app_state")
    .select("input, scenarios, ap_adjustments, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 503 });
  if (!cur) {
    // Row vanished — recreate it.
    const { error: insErr } = await sb.from("app_state").insert(row);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 503 });
    return NextResponse.json({ ok: true, updatedAt: now });
  }
  // Conflict: hand back the current doc so the client can rebase onto it.
  return NextResponse.json(
    {
      error: "conflict",
      current: {
        input: cur.input,
        scenarios: cur.scenarios ?? [],
        adjustments: cur.ap_adjustments ?? {},
        updatedAt: cur.updated_at ?? null,
      },
    },
    { status: 409 },
  );
}
