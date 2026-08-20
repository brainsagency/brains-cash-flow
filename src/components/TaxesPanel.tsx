"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TAX_RATE,
  profitYears,
  taxInstallments,
  type TaxInstallment,
  type TaxSettings,
} from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ProjectionsStatus {
  configured: boolean;
  serviceAccountEmail: string | null;
  spreadsheetId: string | null;
  syncedAt: string | null;
  tabTitle: string | null;
  matchedLabel: string | null;
  year: number | null;
  monthCount: number;
  missingMonths: string[];
}

function hoursAgo(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Taxes — quarterly estimated payments derived from the projections sheet.
 *
 * The panel makes the chain visible end to end: which sheet and row the profit
 * came from, the rate, the year-to-date true-up per quarter, and the resulting
 * cash out. Nothing here is a black box the runway silently depends on.
 */
export function TaxesPanel() {
  const { input, setInput, projections, taxOverrides, refreshProjections } = useStore();
  const [status, setStatus] = useState<ProjectionsStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const settings: TaxSettings = input.taxes ?? { enabled: false, rate: DEFAULT_TAX_RATE };
  const merged = settings.monthlyProfit ?? {};
  const installments = settings.enabled ? taxInstallments(settings) : [];

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/projections/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as ProjectionsStatus);
    } catch {
      /* offline — the panel still works on hand-entered figures */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sync/projections", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) setSyncError(body.error ?? `Sync failed (${res.status}).`);
      else await Promise.all([refreshProjections(), loadStatus()]);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  // Every write is surgical against the MANUAL layer — `input` here is the
  // merged view (sheet under overrides), so patching it wholesale would bake
  // today's synced figures in as permanent hand-entered values.
  const patch = (p: Partial<TaxSettings>) =>
    setInput((prev) => ({
      ...prev,
      taxes: { enabled: false, rate: DEFAULT_TAX_RATE, ...(prev.taxes ?? {}), ...p },
    }));

  const setOverride = (month: string, value: number | null) =>
    setInput((prev) => {
      const base = prev.taxes ?? { enabled: false, rate: DEFAULT_TAX_RATE };
      const next = { ...(base.monthlyProfit ?? {}) };
      if (value === null) delete next[month];
      else next[month] = value;
      return { ...prev, taxes: { ...base, monthlyProfit: next } };
    });

  // Drop every hand-typed month so the sheet takes over. Guarded on there
  // actually being synced figures — otherwise this quietly empties the
  // schedule, which looks like a bug rather than a choice.
  const overrideCount = Object.keys(taxOverrides).length;
  const hasSyncedProfit = Object.keys(projections.monthlyProfit).length > 0;
  const clearOverrides = () =>
    setInput((prev) => {
      const base = prev.taxes ?? { enabled: false, rate: DEFAULT_TAX_RATE };
      const { monthlyProfit: _dropped, ...rest } = base;
      return { ...prev, taxes: rest };
    });

  const years = profitYears(merged);
  const displayYears = years.length > 0 ? years : [new Date().getUTCFullYear()];
  // An installment dated before the anchor is silently dropped by the engine
  // (periods start at the anchor), so it contributes nothing to the projection
  // either way — but the user needs to know whether that is because it was
  // paid or because the forecast simply cannot see it.
  const anchor = input.anchorDate;
  const staleInstallments = installments.filter((i) => !i.paid && i.amount > 0 && i.dueDate < anchor);
  const staleTotal = staleInstallments.reduce((s, i) => s + i.amount, 0);
  const upcoming = installments.filter((i) => !i.paid && i.amount > 0 && i.dueDate >= anchor);
  const upcomingTotal = upcoming.reduce((s, i) => s + i.amount, 0);
  const ratePct = (settings.rate ?? DEFAULT_TAX_RATE) * 100;

  return (
    <div className="grid" style={{ gap: 20 }}>
      {/* ---------------- Source ---------------- */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Profit source</h2>
          <div className="spacer" />
          {status?.syncedAt ? (
            <span className="chip committed" style={{ marginRight: 10 }}>
              Synced {hoursAgo(status.syncedAt)}
            </span>
          ) : (
            <span className="chip neutral" style={{ marginRight: 10 }}>
              {status?.configured ? "Never synced" : "Not connected"}
            </span>
          )}
          <button className="btn sm ghost" onClick={sync} disabled={syncing || !status?.configured}>
            {syncing ? "Reading…" : "Sync now"}
          </button>
        </div>

        <div className="muted" style={{ marginBottom: 12 }}>
          Monthly operating profit is read from the <b>Brains Projections</b> sheet — the same{" "}
          <b>Projected Operating Profit</b> row that feeds the financial model. The cash-flow tool never recomputes
          profit; it turns that number into dated cash out.
        </div>

        {status?.configured && status.tabTitle && (
          <>
            <div className="spec-row">
              <span className="label">
                Tab
                <span className="meta">read {status.syncedAt ? hoursAgo(status.syncedAt) : "never"}</span>
              </span>
              <span className="val mono">{status.tabTitle}</span>
            </div>
            <div className="spec-row">
              <span className="label">
                Row matched
                <span className="meta">located by label, not cell address</span>
              </span>
              <span className="val mono">{status.matchedLabel}</span>
            </div>
            <div className="spec-row">
              <span className="label">
                Months with a figure
                <span className="meta">
                  {status.missingMonths.length > 0 ? `missing ${status.missingMonths.join(", ")}` : "complete year"}
                </span>
              </span>
              <span className="val mono">{status.monthCount} / 12</span>
            </div>
          </>
        )}

        {!status?.configured && (
          <div className="alert warning">
            <span className="ico">🔑</span>
            <span>
              <b>Not connected yet.</b> Set <code>GOOGLE_SHEETS_CLIENT_EMAIL</code>,{" "}
              <code>GOOGLE_SHEETS_PRIVATE_KEY</code>, and <code>PROJECTIONS_SHEET_ID</code>, then share the projections
              sheet with the service account as a Viewer. Steps are in <code>docs/PROJECTIONS.md</code>. Until then you
              can type the monthly figures in by hand below and everything else works.
            </span>
          </div>
        )}

        {status?.configured && status.serviceAccountEmail && !status.syncedAt && (
          <div className="alert warning">
            <span className="ico">📄</span>
            <span>
              Configured but never synced. Make sure the sheet is shared with{" "}
              <b className="mono">{status.serviceAccountEmail}</b> as a Viewer, then hit <b>Sync now</b>.
            </span>
          </div>
        )}

        {syncError && (
          <div className="alert critical" style={{ marginTop: 12 }}>
            <span className="ico">⚠️</span>
            <span>
              <b>Sync failed:</b> {syncError}
            </span>
          </div>
        )}
      </div>

      {/* ---------------- Settings ---------------- */}
      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Tax assumptions</h2>
          <div className="spacer" />
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Include taxes in the forecast
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          <div className="field">
            <label>Blended tax rate (%)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={Number.isFinite(ratePct) ? Number(ratePct.toFixed(2)) : 35}
              onChange={(e) => patch({ rate: Number(e.target.value) / 100 })}
            />
            <span className="muted">
              Applied to year-to-date operating profit. 35% matches the model&apos;s Federal Estimated Taxes row.
            </span>
          </div>
          <div className="field">
            <label>Paid through</label>
            <input
              type="date"
              value={settings.paidThrough ?? ""}
              onChange={(e) => patch({ paidThrough: e.target.value || undefined })}
            />
            <span className="muted">
              Installments due on or before this drop out — their cash already left the bank.
            </span>
          </div>
          <div className="field">
            <label>Scheduled cash out ahead</label>
            <div className="val mono" style={{ fontSize: 20, fontWeight: 650, paddingTop: 4 }}>
              {fmtMoney(upcomingTotal)}
            </div>
            <span className="muted">
              {settings.enabled
                ? `${upcoming.length} payment${upcoming.length === 1 ? "" : "s"} in the forecast`
                : "Taxes are excluded from the forecast"}
            </span>
          </div>
        </div>

        {!settings.enabled && (
          <div className="muted" style={{ marginTop: 14 }}>
            Turn this on to add a <b>Taxes</b> line to the cash-out breakdown. Nothing below affects the forecast while
            it&apos;s off.
          </div>
        )}
      </div>

      {/* ---------------- Schedule ---------------- */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>
            Quarterly estimated payments
          </h2>
          <div className="spacer" />
          <span className="pill-total mono">{fmtMoney(upcomingTotal)} ahead</span>
        </div>
        <div className="muted" style={{ marginBottom: 14 }}>
          Each due date pays <b>(year-to-date profit × rate) − everything already paid this year</b>, floored at zero.
          A loss later in the year shrinks the next payment rather than generating a refund — which is how estimated
          taxes actually settle. Note the IRS periods are 3, 2, 3, and 4 months long, not even quarters.
        </div>

        {staleInstallments.length > 0 && (
          <div className="alert warning" style={{ marginBottom: 14 }}>
            <span className="ico">🗓️</span>
            <span>
              <b>
                {staleInstallments.length} installment
                {staleInstallments.length === 1 ? " is" : "s are"} dated before the forecast starts
              </b>{" "}
              ({staleInstallments.map((i) => `${i.label} ${i.year}`).join(", ")}, {fmtMoney(staleTotal)} total), so
              they aren&apos;t counted in your cash projection. If they were paid, set <b>Paid through</b> above to
              confirm it. If they weren&apos;t, they&apos;re a real liability the forecast is not showing — add them as
              a one-off withdrawal on the date you expect to pay.
            </span>
          </div>
        )}

        {installments.length === 0 ? (
          <div className="muted">
            {settings.enabled
              ? "No profit figures yet — sync the sheet or enter months below."
              : "Enable taxes above to see the schedule."}
          </div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--text-dim)", fontSize: 12 }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Period</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Due</th>
                  <th style={{ padding: "6px 8px" }}>YTD profit</th>
                  <th style={{ padding: "6px 8px" }}>YTD liability</th>
                  <th style={{ padding: "6px 8px" }}>Already paid</th>
                  <th style={{ padding: "6px 8px" }}>Payment</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i) => (
                  <ScheduleRow key={i.id} installment={i} anchor={anchor} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------- Monthly profit ---------------- */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>
            Monthly operating profit
          </h2>
          <div className="spacer" />
          {overrideCount > 0 && (
            <>
              <span className="chip info" style={{ marginRight: 10 }}>
                {overrideCount} typed by hand
              </span>
              <button
                className="btn sm ghost"
                onClick={clearOverrides}
                disabled={!hasSyncedProfit}
                title={
                  hasSyncedProfit
                    ? "Drop every hand-typed figure and follow the sheet"
                    : "Nothing synced yet — clearing would leave the schedule empty"
                }
              >
                Use sheet values
              </button>
            </>
          )}
        </div>
        <div className="muted" style={{ marginBottom: 4 }}>
          Straight from the sheet. Type over any month to correct it — a typed value wins over the sheet and survives
          the nightly sync, so a known adjustment isn&apos;t clobbered. Clear the field to go back to the synced figure.
        </div>

        {displayYears.map((year) => {
          const yearTotal = MONTHS.reduce((s, _, m) => {
            const v = merged[`${year}-${String(m + 1).padStart(2, "0")}`];
            return s + (typeof v === "number" ? v : 0);
          }, 0);
          return (
            <div className="amex-section" key={year} style={{ marginTop: 14 }}>
              <div className="row">
                <b style={{ fontSize: 13 }}>{year}</b>
                <div className="spacer" />
                <span className="muted">Year total</span>
                <span className="mono" style={{ marginLeft: 8, fontWeight: 650 }}>
                  {fmtMoney(yearTotal)}
                </span>
              </div>
              <div className="amex-grid">
                {MONTHS.map((label, m) => {
                  const key = `${year}-${String(m + 1).padStart(2, "0")}`;
                  const overridden = taxOverrides[key] !== undefined;
                  const synced = projections.monthlyProfit[key];
                  const value = merged[key];
                  return (
                    <div className={`amex-month${overridden ? " actual" : ""}`} key={key}>
                      <span
                        className="m"
                        title={
                          overridden
                            ? `Typed by hand${typeof synced === "number" ? ` · sheet says ${fmtMoney(synced)}` : ""}`
                            : typeof synced === "number"
                              ? "From the projections sheet"
                              : "No figure yet"
                        }
                      >
                        {label}
                        {overridden ? " ✎" : ""}
                      </span>
                      <div className="money-input">
                        <span className="prefix">$</span>
                        <input
                          type="number"
                          value={typeof value === "number" ? value : ""}
                          placeholder="—"
                          onChange={(e) =>
                            setOverride(key, e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleRow({ installment: i, anchor }: { installment: TaxInstallment; anchor: string }) {
  // Before the anchor the engine cannot place the event at all, so this is
  // "not in the forecast", which is a stronger statement than "late".
  const stale = !i.paid && i.amount > 0 && i.dueDate < anchor;
  const cell = { padding: "8px", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td style={{ padding: "8px", fontWeight: 600 }}>
        {i.label} {i.year}
        <div className="muted">
          {i.fromMonth.slice(5)}–{i.throughMonth.slice(5)}
          {i.missingMonths.length > 0 ? ` · ${i.missingMonths.length} month(s) missing` : ""}
        </div>
      </td>
      <td style={{ padding: "8px" }} className="mono">
        {fmtShortDate(i.dueDate)}
      </td>
      <td style={cell} className={i.ytdProfit < 0 ? "value neg" : undefined}>
        {fmtMoney(i.ytdProfit)}
      </td>
      <td style={cell}>{fmtMoney(i.ytdLiability)}</td>
      <td style={{ ...cell, color: "var(--text-dim)" }}>{fmtMoney(i.priorScheduled)}</td>
      <td style={{ ...cell, fontWeight: 650 }}>{fmtMoney(i.amount)}</td>
      <td style={{ padding: "8px" }}>
        {i.paid ? (
          <span className="chip neutral">Paid</span>
        ) : i.amount === 0 ? (
          <span className="chip neutral" title="Losses since the last payment wiped out the incremental liability">
            Nothing owed
          </span>
        ) : stale ? (
          <span
            className="chip danger"
            title="Dated before the forecast start, so it is not counted in the projection. Set 'Paid through' if it has been paid."
          >
            Not in forecast
          </span>
        ) : (
          <span className="chip committed">Scheduled</span>
        )}
      </td>
    </tr>
  );
}
