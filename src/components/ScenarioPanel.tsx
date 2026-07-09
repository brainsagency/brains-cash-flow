"use client";

import type { CSSProperties } from "react";
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
  views: ScenarioView[];
  onCreate: () => void;
  onEdit: (s: Scenario) => void;
}

const PANEL = "#edead6";
const BLUE = "#3565e3";
const PERI = "#9a9ad6";
const eyebrow: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)" };

export function ScenarioPanel({ scenarios, selectedIds, colorFor, onToggle, base, views, onCreate, onEdit }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            <span style={eyebrow}>Scenarios</span>
            <span style={{ fontSize: 13.5, color: "var(--text-faint)" }}>toggle any on the chart to compare</span>
          </div>
          <button onClick={onCreate} style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", padding: "9px 16px", borderRadius: 8, cursor: "pointer", border: "none", background: "var(--green)", color: "#fff" }}>+ New scenario</button>
        </div>

        {scenarios.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 13.5 }}>No scenarios yet — create one to model layoffs, new revenue, hires, or a combo.</div>
        )}

        {/* Scenario panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {scenarios.map((s) => {
            const on = selectedIds.includes(s.id);
            const color = colorFor(s.id);
            const chips = s.levers.map(leverLabel);
            return (
              <div key={s.id} style={{ background: PANEL, border: `1.5px solid ${on ? BLUE : "transparent"}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div onClick={() => onToggle(s.id)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: 0 }}>
                    <Check on={on} color={color} />
                    <span style={{ fontWeight: 700, fontSize: 15.5, color: "var(--text)" }}>{s.name}</span>
                  </div>
                  <button onClick={() => onEdit(s)} style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0, flex: "0 0 auto" }}>Edit</button>
                </div>
                {chips.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {chips.map((c, i) => (
                      <span key={i} style={{ fontSize: 12.5, color: "#4a4a4a", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 11px" }}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Compare table */}
        {views.length > 0 && <CompareTable base={base} views={views} />}
      </div>
    </div>
  );
}

function Check({ on, color }: { on: boolean; color: string }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 5, flex: "0 0 auto", background: on ? color : "#cbc8b8", display: "grid", placeItems: "center" }}>
      {on && (
        <svg width={12} height={12} viewBox="0 0 24 24"><path d="M5 13l4 4 10-11" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </span>
  );
}

function CompareTable({ base, views }: { base: ForecastResult; views: ScenarioView[] }) {
  const grid = "minmax(0,1.4fr) 100px 168px 148px 168px";
  const th = (t: string, right?: boolean): CSSProperties => ({ ...eyebrow, fontSize: 11, letterSpacing: ".12em", textAlign: right ? "right" : "left" });
  const num = (v: string, color?: string): CSSProperties => ({ fontSize: 14.5, fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 500, color: color ?? "var(--text)" });
  const rows = [
    { name: "Base", color: PERI, runway: base.runwayMonths, cash: finalEnding(base), delta: null as number | null, reserve: base.reserveExcess },
    ...views.map((v) => ({ name: v.scenario.name, color: v.color, runway: v.result.runwayMonths, cash: finalEnding(v.result), delta: finalEnding(v.result) - finalEnding(base), reserve: v.result.reserveExcess })),
  ];
  return (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <div style={{ minWidth: 720 }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 12, alignItems: "center", padding: "0 4px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={th("Scenario")}>Scenario</div>
          <div style={th("Runway", true)}>Runway</div>
          <div style={th("Cash", true)}>Cash at horizon end</div>
          <div style={th("d", true)}>Δ vs base</div>
          <div style={th("Reserve", true)}>Reserve position</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: grid, gap: 12, alignItems: "center", padding: "13px 4px", borderBottom: i < rows.length - 1 ? "1px solid rgba(19,19,19,0.05)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: r.color, flex: "0 0 auto" }} />
              <span style={{ fontSize: 14.5, fontWeight: i === 0 ? 500 : 700, color: "var(--text)" }}>{r.name}</span>
            </div>
            <div style={num(fmtMonths(r.runway))}>{fmtMonths(r.runway)}</div>
            <div style={num(fmtMoney(r.cash), r.cash < 0 ? "var(--red)" : undefined)}>{fmtMoney(r.cash)}</div>
            <div style={num(r.delta == null ? "—" : fmtMoney(r.delta, { sign: true }), r.delta == null ? "var(--text-faint)" : r.delta < 0 ? "var(--red)" : undefined)}>
              {r.delta == null ? "—" : fmtMoney(r.delta, { sign: true })}
            </div>
            <div style={num(fmtMoney(r.reserve), r.reserve < 0 ? "var(--red)" : undefined)}>{fmtMoney(r.reserve)}</div>
          </div>
        ))}
      </div>
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
    case "layoffGroup": {
      const hasSev = (l.severanceWeeks ?? 0) > 0 || Object.keys(l.severanceByStaff ?? {}).length > 0;
      return `– Lay off ${l.staffIds.length}${hasSev ? " (+sev)" : ""}`;
    }
    case "addRevenue":
      return `+ ${l.label || "Revenue"} ${fmtMoney(l.amount)}${l.mode === "recurring" ? "/mo" : ""}`;
    case "churn":
      return `– Churn ${l.client}`;
    case "pipelineSensitivity":
      return `Pipeline ×${l.winRateMultiplier ?? 1}${l.slipDays ? `, +${l.slipDays}d` : ""}`;
    case "collectionTiming":
      return `Collections ${l.overdueShiftDays >= 0 ? "+" : ""}${l.overdueShiftDays}d`;
  }
}
