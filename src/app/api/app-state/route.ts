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
  let body: { input?: { anchorDate?: string; bankAccounts?: unknown[] }; scenarios?: unknown[]; adjustments?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Minimal shape check so a buggy client can't wipe the workspace.
  if (!body.input?.anchorDate || !Array.isArray(body.input.bankAccounts)) {
    return NextResponse.json({ error: "input.anchorDate and input.bankAccounts required" }, { status: 400 });
  }
  const { error } = await supabaseAdmin().from("app_state").upsert({
    id: "default",
    input: body.input,
    scenarios: body.scenarios ?? [],
    ap_adjustments: body.adjustments ?? {},
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
