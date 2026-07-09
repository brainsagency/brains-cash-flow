"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { daysBetween, type ForecastResult, type Scenario } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { CashChart, type ChartPoint, type Overlay } from "@/components/CashChart.js";
import { ScenarioMenu } from "@/components/ScenarioMenu.js";
import { fmtAxisLabel, fmtDuration, fmtMoney, fmtShortDate } from "@/lib/format.js";

export interface RangeOption {
  value: number;
  label: string;
}

interface Props {
  view: "week" | "month";
  onView: (view: "week" | "month") => void;
  result: ForecastResult;
  overlays: Overlay[];
  rangeOptions: RangeOption[];
  rangeValue: number;
  onRange: (value: number) => void;
  scenarios: Scenario[];
  selectedIds: string[];
  colorFor: (id: string) => string;
  onToggleScenario: (id: string) => void;
  onCreateScenario: () => void;
}

const GREEN = "#2e7354";

export function CashFlowCard({
  view, onView, result, overlays, rangeOptions, rangeValue, onRange,
  scenarios, selectedIds, colorFor, onToggleScenario, onCreateScenario,
}: Props) {
  const { setInput } = useStore();
  const [showBalances, setShowBalances] = useState(false);
  const threshold = result.settings.lowCashThreshold ?? 250_000;

  const toggleOperating = (id: string, operating: boolean) =>
    setInput((prev) => ({ ...prev, bankAccounts: prev.bankAccounts.map((a) => (a.id === id ? { ...a, operating } : a)) }));

  const series: ChartPoint[] = useMemo(
    () => result.periods.map((p) => ({ date: p.period.start, label: fmtAxisLabel(p.period.start, view), ending: p.endingBalance })),
    [result, view],
  );

  const operating = result.bankAccounts.filter((a) => a.operating !== false);
  const accountCount = operating.length;
  const balanceAsOf = operating.map((a) => a.balanceAsOf).filter((d): d is string => Boolean(d)).sort()[0];

  const breach = useMemo(() => {
    const p = result.periods.find((pp) => pp.endingBalance < threshold);
    return p ? { date: p.period.start, days: Math.max(0, daysBetween(result.anchorDate, p.period.start)) } : null;
  }, [result, threshold]);
  const cashOut = useMemo(() => {
    const p = result.periods.find((pp) => pp.endingBalance < 0);
    return p ? { date: p.period.start, days: Math.max(0, daysBetween(result.anchorDate, p.period.start)) } : null;
  }, [result]);

  const unit = view === "week" ? "days" : "months";

  return (
    <section className="card">
      {/* Header: forecast controls + scenarios */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={eyebrow}>Forecast</span>
          <Segmented
            options={[{ v: "week", label: "Weekly" }, { v: "month", label: "Monthly" }]}
            value={view}
            onPick={onView}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Segmented options={rangeOptions.map((o) => ({ v: o.value, label: o.label }))} value={rangeValue} onPick={onRange} />
          <ScenarioMenu scenarios={scenarios} selectedIds={selectedIds} colorFor={colorFor} onToggle={onToggleScenario} onCreate={onCreateScenario} />
        </div>
      </div>

      {/* Body: stats column + chart */}
      <div style={{ display: "flex", gap: 28, alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 232px", display: "flex", flexDirection: "column", gap: 24, paddingRight: 26, borderRight: "1px solid var(--border)", position: "relative" }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={eyebrow}>Today&apos;s balance</span>
              {balanceAsOf && <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>as of {fmtShortDate(balanceAsOf)}</span>}
            </div>
            <button onClick={() => setShowBalances((v) => !v)} style={{ ...bigNum(false), background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 6 }} title="Show account balances">
              {fmtMoney(result.startingCash)} <span style={{ fontSize: 13, color: "var(--text-dim)" }}>▾</span>
            </button>
            <div style={sub}>From {accountCount} bank account{accountCount === 1 ? "" : "s"}</div>
            {showBalances && (
              <BalancesPopover accounts={result.bankAccounts} operatingTotal={result.startingCash} onToggle={toggleOperating} onClose={() => setShowBalances(false)} />
            )}
          </div>
          <div>
            <div style={eyebrow}>Cash-out (below $0)</div>
            <div style={bigNum(!!cashOut)}>{cashOut ? fmtDuration(cashOut.days, unit) : "—"}</div>
            <div style={sub}>{cashOut ? fmtShortDate(cashOut.date) : "stays above $0"}</div>
          </div>
          <div>
            <div style={eyebrow}>Drops below {fmtMoney(threshold)}</div>
            <div style={bigNum(!!breach)}>{breach ? fmtDuration(breach.days, unit) : "—"}</div>
            <div style={sub}>{breach ? fmtShortDate(breach.date) : "stays above the floor"}</div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <LegendItem color={GREEN} label="Base" />
            {overlays.map((o) => <LegendItem key={o.name} color={o.color} label={o.name} dashed />)}
          </div>
          <CashChart series={series} threshold={threshold} overlays={overlays} todayLabel="today" />
        </div>
      </div>
    </section>
  );
}

const eyebrow: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)" };
const sub: CSSProperties = { fontSize: 13, color: "var(--text-dim)", marginTop: 7 };
const bigNum = (danger: boolean): CSSProperties => ({ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 42, lineHeight: 0.92, color: danger ? "var(--red)" : "var(--text)", letterSpacing: ".004em" });

function Segmented<T extends string | number>({ options, value, onPick }: { options: Array<{ v: T; label: string }>; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const a = o.v === value;
        return (
          <button
            key={String(o.v)}
            onClick={() => onPick(o.v)}
            style={{
              cursor: "pointer", borderRadius: 6, padding: "6px 12px", fontFamily: "var(--font-cond)", fontWeight: 700,
              fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", background: a ? "#fff" : "transparent",
              color: a ? "var(--text)" : "var(--text-dim)", border: a ? "1px solid var(--border)" : "1px solid transparent",
              boxShadow: a ? "0 1px 2px rgba(19,19,19,0.05)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 20, height: 0, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`, flex: "0 0 auto" }} />
      <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".06em", color: "#4a4a4a" }}>{label}</span>
    </div>
  );
}

function BalancesPopover({
  accounts, operatingTotal, onToggle, onClose,
}: {
  accounts: ForecastResult["bankAccounts"];
  operatingTotal: number;
  onToggle: (id: string, operating: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover" role="dialog" aria-label="Bank account balances">
        <div className="pop-head">Accounts — tick which count toward cash flow</div>
        {accounts.map((a) => {
          const on = a.operating !== false;
          return (
            <label key={a.id} className="pop-row">
              <input type="checkbox" checked={on} onChange={(e) => onToggle(a.id, e.target.checked)} />
              <span className="pop-name">
                {a.name}
                {a.mask ? ` …${a.mask}` : ""}
                {a.balanceAsOf ? <span className="pop-asof"> · {fmtShortDate(a.balanceAsOf)}</span> : null}
              </span>
              <span className={`pop-bal mono ${on ? "" : "muted"}`}>{fmtMoney(a.beginningBalance)}</span>
            </label>
          );
        })}
        <div className="pop-total">
          <span>Operating cash</span>
          <span className="mono">{fmtMoney(operatingTotal)}</span>
        </div>
      </div>
    </>
  );
}
