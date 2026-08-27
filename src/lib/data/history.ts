"use client";

/**
 * Forecast history — the snapshots behind Insights → "What's changed".
 *
 * Cloud (Supabase via /api/snapshots) when available, so the whole team diffs
 * against the same history; per-browser localStorage when that route is
 * unavailable, so the feature still works before the table exists. Same
 * additive contract as the workspace document itself.
 *
 * Snapshots hold the *merged* input (manual layer + synced AR/AP + roster and
 * tax expansion) — the same thing the forecast runs on, so a diff reflects
 * everything that moves cash, including a nightly sync.
 */

import type { ForecastInput, ForecastResult } from "@engine/index.js";

const LOCAL_KEY = "brains-cashflow-history-v1";
/** Local history is capped tighter than the cloud's — localStorage is ~5MB. */
const LOCAL_MAX = 8;
/** Minimum gap between captures. The server enforces its own copy of this. */
const MIN_CAPTURE_HOURS = 20;

export type HistoryMode = "cloud" | "local";

/** The headline figures, stored alongside each snapshot for cheap display. */
export interface SnapshotMetrics {
  startingCash: number;
  endingCash: number;
  runwayMonths: number | null;
  monthlyBurn: number;
}

export interface SnapshotMeta {
  id: string;
  capturedAt: string;
  anchor: string;
  metrics: SnapshotMetrics;
}

export interface Snapshot extends SnapshotMeta {
  input: ForecastInput;
}

export function metricsOf(result: ForecastResult): SnapshotMetrics {
  const last = result.periods[result.periods.length - 1];
  return {
    startingCash: result.startingCash,
    endingCash: last?.endingBalance ?? result.startingCash,
    runwayMonths: result.runwayMonths,
    monthlyBurn: result.monthlyBurn,
  };
}

// ---------------------------------------------------------------------------
// localStorage fallback
// ---------------------------------------------------------------------------

function readLocal(): Snapshot[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as Snapshot[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(list: Snapshot[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, LOCAL_MAX)));
  } catch {
    // Over quota (or storage disabled): drop the oldest half and try once more.
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, Math.floor(LOCAL_MAX / 2))));
    } catch {
      /* history is a nicety — never break the app over it */
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — cloud first, local fallback
// ---------------------------------------------------------------------------

/** The snapshot index, newest first, and where it came from. */
export async function listSnapshots(): Promise<{ mode: HistoryMode; snapshots: SnapshotMeta[] }> {
  try {
    const res = await fetch("/api/snapshots", { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as { snapshots?: SnapshotMeta[] };
      return { mode: "cloud", snapshots: body.snapshots ?? [] };
    }
  } catch {
    /* route unreachable — fall through to this browser's history */
  }
  return { mode: "local", snapshots: readLocal().map(({ input: _input, ...m }) => m) };
}

/** One snapshot with its full input, ready to diff against. */
export async function loadSnapshot(id: string, mode: HistoryMode): Promise<Snapshot | null> {
  if (mode === "local") return readLocal().find((s) => s.id === id) ?? null;
  try {
    const res = await fetch(`/api/snapshots?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { snapshot?: Snapshot };
    return body.snapshot ?? null;
  } catch {
    return null;
  }
}

/**
 * Record where things stand, unless a recent snapshot already covers this
 * window. Called once per load: the snapshot then represents the state the day
 * opened with, so the diff shows what the day (and the overnight sync) did.
 */
export async function captureSnapshot(
  input: ForecastInput,
  metrics: SnapshotMetrics,
  mode: HistoryMode,
): Promise<void> {
  if (mode === "cloud") {
    try {
      await fetch("/api/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, metrics, minHours: MIN_CAPTURE_HOURS }),
      });
    } catch {
      /* offline — the next load will capture */
    }
    return;
  }

  const list = readLocal();
  const newest = list[0]?.capturedAt;
  if (newest && Date.now() - new Date(newest).getTime() < MIN_CAPTURE_HOURS * 3_600_000) return;
  const capturedAt = new Date().toISOString();
  writeLocal([{ id: capturedAt, capturedAt, anchor: input.anchorDate, metrics, input }, ...list]);
}

/**
 * The best snapshot to compare against for a "last N days" view: the newest one
 * at least `days` old, falling back to the oldest we have. Returning something
 * older than asked is the honest answer — better than an empty panel when
 * history is still short — and the UI labels the real date either way.
 */
export function baselineFor(snapshots: SnapshotMeta[], days: number): SnapshotMeta | null {
  if (snapshots.length === 0) return null;
  const cutoff = Date.now() - days * 86_400_000;
  const aged = snapshots.find((s) => new Date(s.capturedAt).getTime() <= cutoff);
  return aged ?? snapshots[snapshots.length - 1] ?? null;
}
