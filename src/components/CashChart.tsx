"use client";

import { useRef, useState } from "react";
import { fmtMoney, fmtMoneyShort } from "@/lib/format.js";

export interface ChartPoint {
  label: string;
  ending: number;
}

export interface Overlay {
  name: string;
  color: string;
  points: ChartPoint[];
}

interface Props {
  series: ChartPoint[];
  reserveTarget: number;
  /** Scenario lines toggled on, each its own color (Float-style). */
  overlays?: Overlay[];
  /** Date cash first crosses ≤ 0, for the "cash-out" marker label. */
  cashOutDate?: string | null;
}

const VBW = 900;
const VBH = 340;
const PAD = { top: 16, right: 18, bottom: 42, left: 64 };
const BASE_COLOR = "#818cf8";

export function CashChart({ series, reserveTarget, overlays = [], cashOutDate }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const plotW = VBW - PAD.left - PAD.right;
  const plotH = VBH - PAD.top - PAD.bottom;
  const n = series.length;
  if (n === 0) return null;

  const allVals = [
    ...series.map((p) => p.ending),
    ...overlays.flatMap((o) => o.points.map((p) => p.ending)),
    reserveTarget,
    0,
  ];
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  const span = yMax - yMin || 1;
  yMin -= span * 0.08;
  yMax += span * 0.08;

  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const linePath = (pts: ChartPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ending).toFixed(1)}`)
      .join(" ");

  const areaPath =
    `M${x(0).toFixed(1)},${y(series[0]!.ending).toFixed(1)} ` +
    series.map((p, i) => `L${x(i).toFixed(1)},${y(p.ending).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${y(yMin).toFixed(1)} L${x(0).toFixed(1)},${y(yMin).toFixed(1)} Z`;

  const cashOutIdx = series.findIndex((p) => p.ending <= 0);
  const zeroInRange = yMin < 0 && yMax > 0;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);
  const labelStep = Math.max(1, Math.ceil(n / 8));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * VBW;
    const i = Math.round(((relX - PAD.left) / plotW) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  const hp = hover !== null ? series[hover] : null;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        role="img"
        aria-label="Projected cash balance over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BASE_COLOR} stopOpacity="0.30" />
            <stop offset="100%" stopColor={BASE_COLOR} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={VBW - PAD.right} y2={y(v)} stroke="#2a323d" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b7684">
              {fmtMoneyShort(v)}
            </text>
          </g>
        ))}

        {zeroInRange && (
          <line x1={PAD.left} y1={y(0)} x2={VBW - PAD.right} y2={y(0)} stroke="#f87171" strokeWidth={1.2} strokeDasharray="2 3" />
        )}

        <line x1={PAD.left} y1={y(reserveTarget)} x2={VBW - PAD.right} y2={y(reserveTarget)} stroke="#fbbf24" strokeWidth={1.3} strokeDasharray="6 4" />
        <text x={VBW - PAD.right} y={y(reserveTarget) - 6} textAnchor="end" fontSize={11} fill="#fbbf24">
          reserve {fmtMoneyShort(reserveTarget)}
        </text>

        <path d={areaPath} fill="url(#cashFill)" />
        <path d={linePath(series)} fill="none" stroke={BASE_COLOR} strokeWidth={2.4} strokeLinejoin="round" />

        {overlays.map((o) => (
          <path key={o.name} d={linePath(o.points)} fill="none" stroke={o.color} strokeWidth={2.1} strokeDasharray="5 4" strokeLinejoin="round" />
        ))}

        {cashOutIdx >= 0 && (
          <g>
            <line x1={x(cashOutIdx)} y1={PAD.top} x2={x(cashOutIdx)} y2={PAD.top + plotH} stroke="#ef4444" strokeWidth={1.4} />
            <text x={x(cashOutIdx) + 5} y={PAD.top + 12} fontSize={11} fill="#f87171">
              cash-out{cashOutDate ? ` · ${cashOutDate}` : ""}
            </text>
          </g>
        )}

        {series.map((p, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={VBH - PAD.bottom + 18} textAnchor="middle" fontSize={10.5} fill="#6b7684">
              {p.label.replace("Wk of ", "")}
            </text>
          ) : null,
        )}

        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={PAD.top + plotH} stroke="#e6edf3" strokeOpacity={0.22} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hp.ending)} r={4} fill={BASE_COLOR} stroke="#0e1116" strokeWidth={1.5} />
            {overlays.map((o) => {
              const pt = o.points[hover];
              return pt ? <circle key={o.name} cx={x(hover)} cy={y(pt.ending)} r={4} fill={o.color} stroke="#0e1116" strokeWidth={1.5} /> : null;
            })}
          </g>
        )}
      </svg>

      {hover !== null && hp && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `${(x(hover) / VBW) * 100}%`,
            transform: hover > n / 2 ? "translateX(-105%)" : "translateX(5%)",
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>{hp.label}</div>
          <div className="mono" style={{ color: BASE_COLOR }}>Base: {fmtMoney(hp.ending)}</div>
          {overlays.map((o) => {
            const pt = o.points[hover];
            return pt ? (
              <div key={o.name} className="mono" style={{ color: o.color }}>
                {o.name}: {fmtMoney(pt.ending)}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
