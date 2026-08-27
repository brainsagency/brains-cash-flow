import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/integrations/supabase.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forecast history: periodic snapshots of the merged workspace, so Insights can
 * answer "what's changed recently" by diffing today against a stored point in
 * time. One snapshot per capture window (a day, by default) is plenty — this is
 * a record of how the outlook moved, not an audit log of every keystroke.
 *
 * The client falls back to a per-browser localStorage history when this returns
 * 503 (Supabase missing / table not created), so history is additive, never a
 * hard dependency — same contract as /api/app-state.
 */

/** Snapshots kept; older ones are pruned on capture. ~4 months of dailies. */
const MAX_SNAPSHOTS = 120;
/** Default minimum gap between captures. */
const DEFAULT_MIN_HOURS = 20;

interface Row {
  id: number;
  captured_at: string;
  anchor: string;
  metrics: unknown;
  input?: unknown;
}

function meta(r: Row) {
  return { id: String(r.id), capturedAt: r.captured_at, anchor: r.anchor, metrics: r.metrics ?? {} };
}

/** `?id=` returns one snapshot with its full input; otherwise the index. */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "cloud storage not configured" }, { status: 503 });
  }
  const sb = supabaseAdmin();
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const { data, error } = await sb
      .from("forecast_snapshot")
      .select("id, captured_at, anchor, metrics, input")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    const row = data as Row;
    return NextResponse.json({ snapshot: { ...meta(row), input: row.input } });
  }

  // Index only — the inputs are large, and the UI needs just one of them.
  const { data, error } = await sb
    .from("forecast_snapshot")
    .select("id, captured_at, anchor, metrics")
    .order("captured_at", { ascending: false })
    .limit(MAX_SNAPSHOTS);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ snapshots: ((data ?? []) as Row[]).map(meta) });
}

/**
 * Capture the current workspace — but only if the newest snapshot is older than
 * `minHours`. Every open tab posts on load, so the dedup lives here, where it's
 * a single authority rather than a race between clients.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "cloud storage not configured" }, { status: 503 });
  }
  let body: { input?: { anchorDate?: string }; metrics?: unknown; minHours?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.input?.anchorDate) {
    return NextResponse.json({ error: "input.anchorDate required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const minHours = Number.isFinite(body.minHours) ? Math.max(0, Number(body.minHours)) : DEFAULT_MIN_HOURS;

  const { data: latest, error: latestErr } = await sb
    .from("forecast_snapshot")
    .select("id, captured_at")
    .order("captured_at", { ascending: false })
    .limit(1);
  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 503 });

  const newest = latest?.[0]?.captured_at as string | undefined;
  if (newest && Date.now() - new Date(newest).getTime() < minHours * 3_600_000) {
    return NextResponse.json({ ok: true, skipped: true, latestAt: newest });
  }

  const capturedAt = new Date().toISOString();
  const { error: insErr } = await sb.from("forecast_snapshot").insert({
    captured_at: capturedAt,
    anchor: body.input.anchorDate,
    input: body.input,
    metrics: body.metrics ?? {},
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 503 });

  // Prune past the cap. Best-effort: a failure here costs storage, not
  // correctness, so the capture still counts as a success.
  const { data: keep } = await sb
    .from("forecast_snapshot")
    .select("captured_at")
    .order("captured_at", { ascending: false })
    .range(MAX_SNAPSHOTS, MAX_SNAPSHOTS);
  const cutoff = keep?.[0]?.captured_at as string | undefined;
  if (cutoff) await sb.from("forecast_snapshot").delete().lte("captured_at", cutoff);

  return NextResponse.json({ ok: true, capturedAt });
}
