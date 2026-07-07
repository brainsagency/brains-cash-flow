"use client";

import { useMemo, useState } from "react";
import { forecast, runScenario } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { OVERLAY_COLORS } from "@/lib/categories.js";
import { KpiCards } from "@/components/KpiCards.js";
import { CashChart, type ChartPoint, type Overlay } from "@/components/CashChart.js";
import { AlertsPanel } from "@/components/AlertsPanel.js";
import { NarrativePanel } from "@/components/NarrativePanel.js";
import { CashMatrix } from "@/components/CashMatrix.js";
import { AssumptionsPanel } from "@/components/AssumptionsPanel.js";
import { ScenarioPanel, type ScenarioView } from "@/components/ScenarioPanel.js";

export default function Dashboard() {
  const { input, scenarios } = useStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const base = useMemo(() => forecast(input), [input]);

  const colorFor = (id: string) => {
    const idx = scenarios.findIndex((s) => s.id === id);
    return OVERLAY_COLORS[idx % OVERLAY_COLORS.length]!;
  };

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

  const baseSeries: ChartPoint[] = base.periods.map((p) => ({
    label: p.period.label,
    ending: p.endingBalance,
  }));
  const overlays: Overlay[] = views.map((v) => ({
    name: v.scenario.name,
    color: v.color,
    points: v.result.periods.map((p) => ({ label: p.period.label, ending: p.endingBalance })),
  }));

  const cashOutPeriod = base.periods.find((p) => p.endingBalance <= 0);
  const cashOutDate = cashOutPeriod ? cashOutPeriod.period.start : null;

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Brains Cash Flow</h1>
          <div className="sub">
            Rolling {input.horizon?.weeklyPeriods ?? 13}-week + {input.horizon?.monthlyPeriods ?? 12}-month
            forecast · anchor {input.anchorDate}
          </div>
        </div>
        <span className="badge">
          <span className="dot" /> Sample data · live syncs pending
        </span>
      </header>

      <KpiCards result={base} />

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Projected cash</h2>
            <div className="spacer" />
            <Legend overlays={overlays} />
          </div>
          <CashChart series={baseSeries} reserveTarget={base.reserveTarget} overlays={overlays} cashOutDate={cashOutDate} />
        </div>
        <div className="grid" style={{ gridTemplateRows: "auto auto", gap: 16 }}>
          <AlertsPanel alerts={base.alerts} />
          <NarrativePanel result={base} />
        </div>
      </div>

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

function Legend({ overlays }: { overlays: Overlay[] }) {
  return (
    <div className="row" style={{ gap: 14, fontSize: 12, color: "var(--text-dim)" }}>
      <span className="row" style={{ gap: 5 }}>
        <span style={{ width: 14, height: 3, background: "#818cf8", display: "inline-block", borderRadius: 2 }} /> Base
      </span>
      {overlays.map((o) => (
        <span key={o.name} className="row" style={{ gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${o.color}`, display: "inline-block" }} /> {o.name}
        </span>
      ))}
      <span className="row" style={{ gap: 5 }}>
        <span style={{ width: 14, height: 0, borderTop: "2px dashed #fbbf24", display: "inline-block" }} /> Reserve
      </span>
    </div>
  );
}
