"use client";

import { useMemo } from "react";
import { daysBetween, type ForecastResult } from "@engine/index.js";
import { CashChart, type ChartPoint, type Overlay } from "@/components/CashChart.js";
import { fmtAxisLabel, fmtDuration, fmtMoney, fmtShortDate } from "@/lib/format.js";

interface Props {
  title: string;
  view: "week" | "month";
  result: ForecastResult;
  overlays: Overlay[];
}

export function CashFlowCard({ title, view, result, overlays }: Props) {
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

  const accountCount = result.bankAccounts.filter((a) => a.operating !== false).length;

  const lowest = useMemo(() => {
    let min = result.periods[0];
    for (const p of result.periods) if (p.endingBalance < (min?.endingBalance ?? Infinity)) min = p;
    return min ? { amount: min.endingBalance, date: min.period.end } : null;
  }, [result]);

  const breach = useMemo(() => {
    const p = result.periods.find((pp) => pp.endingBalance < threshold);
    if (!p) return null;
    return { date: p.period.start, days: Math.max(0, daysBetween(result.anchorDate, p.period.start)) };
  }, [result, threshold]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>{title}</h2>
        <div className="spacer" />
        <Legend overlays={overlays} />
      </div>

      <div className="grid hero">
        <div className="callout">
          <Stat name="Today's balance" date={fmtShortDate(result.anchorDate)} value={fmtMoney(result.startingCash)} sub={`From ${accountCount} bank account${accountCount === 1 ? "" : "s"}`} />
          {lowest && (
            <Stat
              name="Lowest balance"
              date={fmtShortDate(lowest.date)}
              value={fmtMoney(lowest.amount)}
              neg={lowest.amount < 0}
            />
          )}
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
