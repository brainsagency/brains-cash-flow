"use client";

import type { ForecastResult, Lever, Scenario } from "@engine/index.js";
import { fmtMoney, fmtMonths } from "@/lib/format.js";

export interface ScenarioView {
  scenario: Scenario;
  color: string;
  result: ForecastResult;
}

interface Props {
  scenarios: Scenario[];
  selectedIds: string[];
  colorFor: (id: string) => string;
  onToggle: (id: string) => void;
  base: ForecastResult;
  /** Selected scenario results, aligned with selectedIds. */
  views: ScenarioView[];
}

export function ScenarioPanel({ scenarios, selectedIds, colorFor, onToggle, base, views }: Props) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Scenarios</h2>
        <span className="muted">toggle any on the chart to compare</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        {scenarios.map((s) => {
          const active = selectedIds.includes(s.id);
          const color = colorFor(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className="card"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderColor: active ? color : "var(--border)",
                background: active ? "var(--bg-elev-2)" : "var(--bg-elev-2)",
                borderWidth: active ? 2 : 1,
              }}
            >
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: active ? color : "var(--border-strong)", display: "inline-block" }} />
                <span style={{ fontWeight: 650 }}>{s.name}</span>
              </div>
              {s.description && <div className="muted" style={{ marginBottom: 8 }}>{s.description}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {s.levers.map((l, i) => (
                  <span key={i} className="chip">{leverLabel(l)}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {views.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="fc">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Runway</th>
                <th>Cash at horizon end</th>
                <th>Δ vs base</th>
                <th>Reserve position</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span style={{ color: "#818cf8" }}>●</span> Base
                </td>
                <td className="mono">{fmtMonths(base.runwayMonths)}</td>
                <td className="mono">{fmtMoney(finalEnding(base))}</td>
                <td className="mono muted">—</td>
                <td className={`mono ${base.reserveExcess < 0 ? "neg" : ""}`}>{fmtMoney(base.reserveExcess)}</td>
              </tr>
              {views.map((v) => {
                const delta = finalEnding(v.result) - finalEnding(base);
                return (
                  <tr key={v.scenario.id}>
                    <td>
                      <span style={{ color: v.color }}>●</span> {v.scenario.name}
                    </td>
                    <td className="mono">{fmtMonths(v.result.runwayMonths)}</td>
                    <td className={`mono ${finalEnding(v.result) < 0 ? "neg" : ""}`}>{fmtMoney(finalEnding(v.result))}</td>
                    <td className={`mono ${delta < 0 ? "neg" : ""}`}>{fmtMoney(delta, { sign: true })}</td>
                    <td className={`mono ${v.result.reserveExcess < 0 ? "neg" : ""}`}>{fmtMoney(v.result.reserveExcess)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function finalEnding(r: ForecastResult): number {
  return r.periods[r.periods.length - 1]?.endingBalance ?? 0;
}

function leverLabel(l: Lever): string {
  switch (l.kind) {
    case "hire":
      return `+ Hire ${l.role}`;
    case "layoff":
      return `– Layoff ${l.role}`;
    case "churn":
      return `– Churn ${l.client}`;
    case "pipelineSensitivity":
      return `Pipeline ×${l.winRateMultiplier ?? 1}${l.slipDays ? `, +${l.slipDays}d` : ""}`;
    case "collectionTiming":
      return `Collections ${l.overdueShiftDays >= 0 ? "+" : ""}${l.overdueShiftDays}d`;
  }
}
