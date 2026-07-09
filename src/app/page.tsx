"use client";

import { useMemo, useState } from "react";
import { forecast, runScenario, type ForecastInput, type HorizonConfig } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { OVERLAY_COLORS } from "@/lib/categories.js";
import { daysAgo, fmtAxisLabel } from "@/lib/format.js";
import { Sidebar, NAV, type ViewKey } from "@/components/Sidebar.js";
import { KpiCards } from "@/components/KpiCards.js";
import { type Overlay } from "@/components/CashChart.js";
import { CashFlowCard, type RangeOption } from "@/components/CashFlowCard.js";
import { CashMatrix } from "@/components/CashMatrix.js";
import { AlertsPanel } from "@/components/AlertsPanel.js";
import { NarrativePanel } from "@/components/NarrativePanel.js";
import { SyncedLedger } from "@/components/SyncedLedger.js";
import { OperatingExpenses } from "@/components/OperatingExpenses.js";
import { StaffRoster } from "@/components/StaffRoster.js";
import { NewBusiness } from "@/components/NewBusiness.js";
import { OtherWithdrawals } from "@/components/OtherWithdrawals.js";
import { QboPanel } from "@/components/QboPanel.js";
import { BillPanel } from "@/components/BillPanel.js";
import { AssumptionsPanel } from "@/components/AssumptionsPanel.js";
import { ScenarioPanel, type ScenarioView } from "@/components/ScenarioPanel.js";
import { ScenarioBuilder } from "@/components/ScenarioBuilder.js";
import type { Scenario } from "@engine/index.js";

const WEEK_RANGES: RangeOption[] = [
  { value: 13, label: "13w" },
  { value: 26, label: "26w" },
  { value: 39, label: "39w" },
  { value: 52, label: "52w" },
];
const MONTH_RANGES: RangeOption[] = [
  { value: 6, label: "6m" },
  { value: 12, label: "12m" },
  { value: 18, label: "18m" },
  { value: 24, label: "24m" },
  { value: 36, label: "36m" },
];

function liveBadgeText(qbo: string | null, bill: string | null): string {
  if (qbo && bill) return "QuickBooks AR + Bill.com AP live · other sources sample";
  if (qbo) return "QuickBooks AR live · other sources sample";
  if (bill) return "Bill.com AP live · other sources sample";
  return "Sample data · live syncs pending";
}

/** A connected feed counts as stale past this (nightly cron + buffer). */
const STALE_AFTER_HOURS = 26;

function staleFeeds(qbo: string | null, bill: string | null): Array<{ name: string; hours: number }> {
  const now = Date.now();
  return [
    { name: "QuickBooks AR", at: qbo },
    { name: "Bill.com AP", at: bill },
  ]
    .filter((f): f is { name: string; at: string } => f.at !== null)
    .map((f) => ({ name: f.name, hours: Math.floor((now - new Date(f.at).getTime()) / 3_600_000) }))
    .filter((f) => f.hours >= STALE_AFTER_HOURS);
}

export default function Dashboard() {
  const { input, scenarios, prefs, setPrefs, setScenarios, qboSyncedAt, billSyncedAt } = useStore();
  const [nav, setNav] = useState<ViewKey>("cashflow");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Scenario builder: null = closed, "new" = create, Scenario = edit.
  const [builder, setBuilder] = useState<Scenario | "new" | null>(null);

  const saveScenario = (s: Scenario) => {
    setScenarios((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]));
    setBuilder(null);
  };
  const deleteScenario = (id: string) => {
    setScenarios((prev) => prev.filter((x) => x.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setBuilder(null);
  };
  const { view, weekRange, monthRange } = prefs;
  const setView = (v: "week" | "month") => setPrefs({ view: v });
  const setWeekRange = (n: number) => setPrefs({ weekRange: n });
  const setMonthRange = (n: number) => setPrefs({ monthRange: n });

  const activeHorizon: HorizonConfig =
    view === "week"
      ? { weeklyPeriods: weekRange, monthlyPeriods: 0 }
      : { weeklyPeriods: 0, monthlyPeriods: monthRange };

  const colorFor = (id: string) => {
    const idx = scenarios.findIndex((s) => s.id === id);
    return OVERLAY_COLORS[idx % OVERLAY_COLORS.length]!;
  };

  const base = useMemo(() => forecast(input), [input]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const active = useMemo(() => forecast({ ...input, horizon: activeHorizon }), [input, view, weekRange, monthRange]);

  const buildOverlays = (baseInput: ForecastInput, v: "week" | "month"): Overlay[] =>
    selectedIds
      .map((id) => {
        const scenario = scenarios.find((s) => s.id === id);
        if (!scenario) return null;
        const r = runScenario(baseInput, scenario);
        return {
          name: scenario.name,
          color: colorFor(id),
          points: r.periods.map((p) => ({
            date: p.period.start,
            label: fmtAxisLabel(p.period.start, v),
            ending: p.endingBalance,
          })),
        };
      })
      .filter((o): o is Overlay => o !== null);

  const activeOverlays = useMemo(
    () => buildOverlays({ ...input, horizon: activeHorizon }, view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, scenarios, selectedIds, view, weekRange, monthRange],
  );

  const views: ScenarioView[] = useMemo(
    () =>
      selectedIds
        .map((id) => {
          const scenario = scenarios.find((s) => s.id === id);
          if (!scenario) return null;
          return { scenario, color: colorFor(id), result: runScenario(input, scenario) };
        })
        .filter((v): v is ScenarioView => v !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, scenarios, selectedIds],
  );

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const navItem = NAV.find((n) => n.key === nav);
  const pageTitle = navItem?.title ?? "Cash Flow";
  const pageEyebrow = navItem?.eyebrow ?? "Overview";
  const stale = staleFeeds(qboSyncedAt, billSyncedAt);
  // Oldest operating bank balance — manual entry, so warn if it's drifting.
  const bankStaleDays = Math.max(
    0,
    ...input.bankAccounts
      .filter((a) => a.operating !== false)
      .map((a) => (a.balanceAsOf ? daysAgo(a.balanceAsOf) : 9999)),
  );
  const bankStale = bankStaleDays >= 10;

  return (
    <div className="layout">
      <Sidebar active={nav} onSelect={setNav} />
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{pageEyebrow}</div>
            <h1>{pageTitle}</h1>
            <div className="sub">Rolling forecast · anchor {input.anchorDate}</div>
          </div>
        </header>

        {stale.length > 0 && (
          <div className="alert critical" style={{ marginBottom: 16 }}>
            <span className="ico">⚠️</span>
            <span>
              <b>Stale data:</b>{" "}
              {stale.map((f) => `${f.name} last synced ${f.hours}h ago`).join("; ")}. The forecast may be out of
              date — refresh from the source panel, or check the nightly sync.
            </span>
          </div>
        )}

        {bankStale && (
          <div className="alert warning" style={{ marginBottom: 16 }}>
            <span className="ico">🏦</span>
            <span>
              <b>Bank balances are {bankStaleDays === 9999 ? "undated" : `${bankStaleDays} days old`}.</b> Starting
              cash drives the whole forecast — update them in Assumptions when you next reconcile.
            </span>
          </div>
        )}

        {nav === "cashflow" && (
          <div className="grid" style={{ gap: 22 }}>
            <CashFlowCard
              view={view}
              onView={setView}
              result={active}
              overlays={activeOverlays}
              rangeOptions={view === "week" ? WEEK_RANGES : MONTH_RANGES}
              rangeValue={view === "week" ? weekRange : monthRange}
              onRange={view === "week" ? setWeekRange : setMonthRange}
              scenarios={scenarios}
              selectedIds={selectedIds}
              colorFor={colorFor}
              onToggleScenario={toggle}
              onCreateScenario={() => setBuilder("new")}
            />
            <CashMatrix result={active} view={view} />
            <NewBusiness />
          </div>
        )}

        {nav === "invoices" && (
          <div className="grid" style={{ gap: 16 }}>
            <QboPanel />
            <SyncedLedger kind="ar" />
          </div>
        )}
        {nav === "bills" && (
          <div className="grid" style={{ gap: 16 }}>
            <BillPanel />
            <SyncedLedger kind="ap" />
            <OtherWithdrawals />
          </div>
        )}

        {nav === "opex" && <OperatingExpenses />}

        {nav === "staff" && <StaffRoster />}

        {nav === "scenarios" && (
          <ScenarioPanel
            scenarios={scenarios}
            selectedIds={selectedIds}
            colorFor={colorFor}
            onToggle={toggle}
            base={base}
            views={views}
            onCreate={() => setBuilder("new")}
            onEdit={(s) => setBuilder(s)}
          />
        )}

        {builder && (
          <ScenarioBuilder
            initial={builder === "new" ? null : builder}
            staff={input.staff ?? []}
            anchor={input.anchorDate}
            onSave={saveScenario}
            onClose={() => setBuilder(null)}
            onDelete={builder !== "new" ? () => deleteScenario(builder.id) : undefined}
          />
        )}

        {nav === "insights" && (
          <div className="grid" style={{ gap: 16 }}>
            <KpiCards result={base} />
            <div className="grid two-col">
              <NarrativePanel result={base} />
              <AlertsPanel alerts={base.alerts} />
            </div>
          </div>
        )}

        {nav === "assumptions" && <AssumptionsPanel />}

        <footer className="app-footer">
          <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
            Read-only against financial systems · figures are projections, reconcile against the sheet before acting ·{" "}
            <a href="mailto:gustavo@brains.co?subject=Brains%20Cash%20Flow%20support">Contact support</a>
          </p>
          <span className="badge">
            <span
              className="dot"
              style={
                stale.length > 0
                  ? { background: "var(--red)" }
                  : qboSyncedAt || billSyncedAt
                    ? { background: "var(--green)" }
                    : { background: "var(--text-faint)" }
              }
            />
            {liveBadgeText(qboSyncedAt, billSyncedAt)}
          </span>
        </footer>
      </main>
    </div>
  );
}
