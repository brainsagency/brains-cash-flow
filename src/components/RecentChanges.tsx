"use client";

import { useEffect, useMemo, useState } from "react";
import {
  changeHeadline,
  diffForecasts,
  narrateChanges,
  type CashChange,
  type ChangeReport,
} from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { baselineFor, loadSnapshot, type Snapshot } from "@/lib/data/history.js";
import { fmtMoney, fmtMonths, fmtShortDate } from "@/lib/format.js";

/**
 * "What's changed" — the story of how the outlook moved since a stored
 * snapshot, then the bullets behind it. Answers the question you actually have
 * on opening the tool: not "what does cash look like" (the chart says that) but
 * "what moved since I last looked, and was it good or bad".
 *
 * The story leads and the figures support it: each bullet is headlined by what
 * happened ("New one-time expense", "Payroll increased") with the line name and
 * amounts underneath. All of it comes from the pure `diffForecasts` /
 * `narrateChanges` engine, so nothing here is inferred or estimated.
 */

const RANGES = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
];

/** How long ago, in words. Snapshots are hours-to-weeks old, never years. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The supporting line under a bullet's headline: which line, and by how much. */
function detail(c: CashChange): string {
  const when = (d?: string) => (d ? fmtShortDate(d) : "—");
  const spread = (n?: number) => (n && n > 1 ? ` across ${n} payments` : "");

  switch (c.kind) {
    case "added":
      return `${fmtMoney(c.after)}${spread(c.afterCount)}, first ${
        c.direction === "in" ? "landing" : "due"
      } ${when(c.afterDate)}.`;
    case "removed":
      return `${fmtMoney(c.before)} that was due ${when(c.beforeDate)} is off the forecast.`;
    case "increased":
    case "decreased": {
      const shift =
        c.dayShift && Math.abs(c.dayShift) >= 1
          ? ` It also moved ${Math.abs(c.dayShift)} days ${c.dayShift > 0 ? "later" : "earlier"}.`
          : "";
      return `${fmtMoney(c.before)} → ${fmtMoney(c.after)}${spread(c.afterCount)} over the horizon.${shift}`;
    }
    case "moved": {
      const days = Math.abs(c.dayShift ?? 0);
      return `${fmtMoney(c.after)}, ${when(c.beforeDate)} → ${when(c.afterDate)} (${days} days ${
        (c.dayShift ?? 0) > 0 ? "later" : "earlier"
      }). Same cash, different week.`;
    }
    case "balance":
      return `${fmtMoney(c.before)} → ${fmtMoney(c.after)}${c.afterDate ? `, as of ${when(c.afterDate)}` : ""}.${
        c.cashImpact === 0 ? " Not part of operating cash, so the forecast is unchanged." : ""
      }`;
  }
}

function ImpactChip({ c }: { c: CashChange }) {
  if (c.cashImpact === 0) return <span className="chg-chip neutral">Timing</span>;
  const good = c.cashImpact > 0;
  return (
    <span className={`chg-chip ${good ? "good" : "bad"}`}>
      {good ? "+" : "−"}
      {fmtMoney(Math.abs(c.cashImpact))}
    </span>
  );
}

export function RecentChanges() {
  const { input, snapshots, historyMode } = useStore();
  const [days, setDays] = useState(7);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = useMemo(() => baselineFor(snapshots, days), [snapshots, days]);

  useEffect(() => {
    if (!meta) {
      setBaseline(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const snap = await loadSnapshot(meta.id, historyMode);
      if (!cancelled) {
        setBaseline(snap);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta, historyMode]);

  const report = useMemo<ChangeReport | null>(() => {
    if (!baseline?.input) return null;
    try {
      return diffForecasts(baseline.input, input);
    } catch {
      // A snapshot from an older shape the engine can't run — skip it rather
      // than take the panel down.
      return null;
    }
  }, [baseline, input]);

  const story = useMemo(
    () => (report && meta ? narrateChanges(report, { since: ago(meta.capturedAt) }) : ""),
    [report, meta],
  );
  const runway = report?.metrics.find((m) => m.key === "runwayMonths");

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ marginBottom: 0 }}>What&apos;s changed</h2>
        <div className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`btn sm ${days === r.days ? "primary" : ""}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="muted">
          History starts with this session&apos;s snapshot. Once there&apos;s a second one to compare
          against, this panel tells you what moved cash between them.
        </div>
      ) : !meta || loading ? (
        <div className="muted">Loading the baseline…</div>
      ) : !report ? (
        <div className="muted">
          That snapshot can&apos;t be compared against the current model — pick a different range.
        </div>
      ) : (
        <>
          <div className="chg-since">
            Compared with {fmtShortDate(meta.capturedAt.slice(0, 10))}, {ago(meta.capturedAt)}
            {historyMode === "local" && " · this browser's history"}
          </div>

          <p className="chg-story">{story}</p>

          <div className="chg-summary">
            <div className="chg-stat">
              <span className="name">Net effect on cash</span>
              <span className={`big ${report.netImpact < 0 ? "neg" : "pos"}`}>
                {fmtMoney(report.netImpact, { sign: true })}
              </span>
              <span className="sub">
                {fmtMoney(report.positiveImpact, { sign: true })} in · {fmtMoney(report.negativeImpact)} out
              </span>
            </div>
            {runway && (
              <div className="chg-stat">
                <span className="name">Runway</span>
                <span className="big">{fmtMonths(runway.after)}</span>
                <span className="sub">
                  {runway.delta === null || Math.abs(runway.delta) < 0.05
                    ? "unchanged"
                    : `${runway.delta > 0 ? "+" : "−"}${Math.abs(runway.delta).toFixed(1)} mo vs ${fmtMonths(runway.before)}`}
                </span>
              </div>
            )}
          </div>

          {report.changes.length === 0 ? (
            <div className="muted">
              Nothing material moved — every difference landed under the reporting threshold.
            </div>
          ) : (
            <ul className="chg-list">
              {report.changes.map((c) => (
                <li key={c.key} className="chg-item">
                  <span
                    className={`chg-dot ${
                      c.cashImpact === 0 ? "neutral" : c.cashImpact > 0 ? "good" : "bad"
                    }`}
                  />
                  <div className="chg-body">
                    <div className="chg-head">
                      <span className="chg-title">{changeHeadline(c)}</span>
                      <div className="spacer" />
                      <ImpactChip c={c} />
                    </div>
                    <div className="chg-detail">
                      <span className="chg-name">{c.label}</span> · {detail(c)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {report.omittedCount > 0 && (
            <div className="chg-foot">
              Plus {report.omittedCount} smaller change{report.omittedCount === 1 ? "" : "s"} netting{" "}
              {fmtMoney(report.omittedImpact, { sign: true })}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
