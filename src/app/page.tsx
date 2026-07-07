"use client";

import { useMemo, useState } from "react";
import { forecast, runScenario, type ForecastInput, type HorizonConfig } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { OVERLAY_COLORS } from "@/lib/categories.js";
import { fmtAxisLabel } from "@/lib/format.js";
import { KpiCards } from "@/components/KpiCards.js";
import { type Overlay } from "@/components/CashChart.js";
import { CashFlowCard } from "@/components/CashFlowCard.js";
import { AlertsPanel } from "@/components/AlertsPanel.js";
import { NarrativePanel } from "@/components/NarrativePanel.js";
import { ReceivablesPayables } from "@/components/ReceivablesPayables.js";
import { CashMatrix } from "@/components/CashMatrix.js";
import { AssumptionsPanel } from "@/components/AssumptionsPanel.js";
import { ScenarioPanel, type ScenarioView } from "@/components/ScenarioPanel.js";

const WEEKLY_HORIZON: HorizonConfig = { weeklyPeriods: 52, monthlyPeriods: 0 };
const MONTHLY_HORIZON: HorizonConfig = { weeklyPeriods: 0, monthlyPeriods: 18 };

export default function Dashboard() {
  const { input, scenarios } = useStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const colorFor = (id: string) => {
    const idx = scenarios.findIndex((s) => s.id === id);
    return OVERLAY_COLORS[idx % OVERLAY_COLORS.length]!;
  };

  // Base (input's own horizon) drives KPIs / alerts / narrative / matrix.
  const base = useMemo(() => forecast(input), [input]);
  const weekly = useMemo(() => forecast({ ...input, horizon: WEEKLY_HORIZON }), [input]);
  const monthly = useMemo(() => forecast({ ...input, horizon: MONTHLY_HORIZON }), [input]);

  const buildOverlays = (baseInput: ForecastInput, view: "week" | "month"): Overlay[] =>
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
            label: fmtAxisLabel(p.period.start, view),
            ending: p.endingBalance,
          })),
        };
      })
      .filter((o): o is Overlay => o !== null);

  const weeklyOverlays = useMemo(
    () => buildOverlays({ ...input, horizon: WEEKLY_HORIZON }, "week"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, scenarios, selectedIds],
  );
  const monthlyOverlays = useMemo(
    () => buildOverlays({ ...input, horizon: MONTHLY_HORIZON }, "month"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, scenarios, selectedIds],
  );

  // Scenario compare table uses the input's own horizon.
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Brains Cash Flow</h1>
          <div className="sub">Rolling forecast · anchor {input.anchorDate}</div>
        </div>
        <span className="badge">
          <span className="dot" /> Sample data · live syncs pending
        </span>
      </header>

      <div className="grid" style={{ gap: 16 }}>
        <CashFlowCard title="Weekly Cash Flow" view="week" result={weekly} overlays={weeklyOverlays} />
        <CashFlowCard title="Monthly Cash Flow" view="month" result={monthly} overlays={monthlyOverlays} />
      </div>

      <div className="section-title">
        <h2>Key metrics</h2>
      </div>
      <KpiCards result={base} />

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <NarrativePanel result={base} />
        <AlertsPanel alerts={base.alerts} />
      </div>

      <div className="section-title">
        <h2>Receivables &amp; payables</h2>
      </div>
      <ReceivablesPayables />

      <div className="section-title">
        <h2>Scenario planning</h2>
      </div>
      <ScenarioPanel
        scenarios={scenarios}
        selectedIds={selectedIds}
        colorFor={colorFor}
        onToggle={toggle}
        base={base}
        views={views}
      />

      <div className="section-title">
        <h2>Detail</h2>
      </div>
      <CashMatrix result={base} />

      <div style={{ marginTop: 16 }}>
        <AssumptionsPanel />
      </div>

      <footer className="muted" style={{ marginTop: 32, textAlign: "center" }}>
        Read-only against financial systems · figures are projections, reconcile against the sheet before acting
      </footer>
    </main>
  );
}
