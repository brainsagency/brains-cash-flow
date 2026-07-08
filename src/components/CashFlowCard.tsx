"use client";

import { useMemo } from "react";
import { daysBetween, type ForecastResult } from "@engine/index.js";
import { CashChart, type ChartPoint, type Overlay } from "@/components/CashChart.js";
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
}

export function CashFlowCard({ view, onView, result, overlays, rangeOptions, rangeValue, onRange }: Props) {
  const threshold = result.settings.lowCashThreshold ?? 250_000;

  const series: ChartPoint[] = useMemo(
    () =>
      result.periods.map((p) => ({
        date: p.period.start,
        label: fmtAxisLabel(p.period.start, view),
        ending: p.endingBalance,
      })),
    [result, view],
  );

  const operating = result.bankAccounts.filter((a) => a.operating !== false);
  const accountCount = operating.length;
  // Oldest operating balance-as-of date, so "today's balance" shows its currency.
  const balanceAsOf = operating
    .map((a) => a.balanceAsOf)
    .filter((d): d is string => Boolean(d))
    .sort()[0];

  const breach = useMemo(() => {
    const p = result.periods.find((pp) => pp.endingBalance < threshold);
    if (!p) return null;
    return { date: p.period.start, days: Math.max(0, daysBetween(result.anchorDate, p.period.start)) };
  }, [result, threshold]);

  // The true cash-out: first period the balance goes below $0.
  const cashOut = useMemo(() => {
    const p = result.periods.find((pp) => pp.endingBalance < 0);
    if (!p) return null;
    return { date: p.period.start, days: Math.max(0, daysBetween(result.anchorDate, p.period.start)) };
  }, [result]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Cash Flow</h2>
        <div className="row" style={{ gap: 3, marginLeft: 12 }}>
          <button className={`btn sm ${view === "week" ? "primary" : "ghost"}`} onClick={() => onView("week")}>
            Weekly
          </button>
          <button className={`btn sm ${view === "month" ? "primary" : "ghost"}`} onClick={() => onView("month")}>
            Monthly
          </button>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 3 }}>
          {rangeOptions.map((o) => (
            <button
              key={o.value}
              className={`btn sm ${o.value === rangeValue ? "primary" : "ghost"}`}
              onClick={() => onRange(o.value)}
              title={`Show ${o.label}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {overlays.length > 0 && (
        <div className="row" style={{ marginBottom: 8, justifyContent: "flex-end" }}>
          <Legend overlays={overlays} />
        </div>
      )}

      <div className="grid hero">
        <div className="callout">
          <Stat
            name="Today's balance"
            date={balanceAsOf ? `as of ${fmtShortDate(balanceAsOf)}` : undefined}
            value={fmtMoney(result.startingCash)}
            sub={`From ${accountCount} bank account${accountCount === 1 ? "" : "s"}`}
          />
          <Stat
            name="Cash-out (below $0)"
            value={cashOut ? fmtDuration(cashOut.days, view === "week" ? "days" : "months") : "—"}
            sub={cashOut ? fmtShortDate(cashOut.date) : "stays above $0"}
            neg={!!cashOut}
          />
          <Stat
            name={`Drops below ${fmtMoney(threshold)}`}
            value={breach ? fmtDuration(breach.days, view === "week" ? "days" : "months") : "—"}
            sub={breach ? fmtShortDate(breach.date) : "stays above the floor"}
            neg={!!breach}
          />
        </div>

        <CashChart series={series} threshold={threshold} overlays={overlays} todayLabel="today" />
      </div>
    </div>
  );
}

function Stat({
  name,
  date,
  value,
  sub,
  neg,
}: {
  name: string;
  date?: string;
  value: string;
  sub?: string;
  neg?: boolean;
}) {
  return (
    <div className="stat">
      <div className="top">
        <span className="name">{name}</span>
        {date && <span className="date">{date}</span>}
      </div>
      <div className={`big mono ${neg ? "neg" : ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Legend({ overlays }: { overlays: Overlay[] }) {
  return (
    <div className="row" style={{ gap: 12, fontSize: 12, color: "var(--text-dim)" }}>
      <span className="row" style={{ gap: 5 }}>
        <span style={{ width: 14, height: 3, background: "#0b7a5b", display: "inline-block", borderRadius: 2 }} /> Base
      </span>
      {overlays.map((o) => (
        <span key={o.name} className="row" style={{ gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${o.color}`, display: "inline-block" }} /> {o.name}
        </span>
      ))}
    </div>
  );
}
