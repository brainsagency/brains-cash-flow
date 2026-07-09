"use client";

import { useRef, useState } from "react";
import { BASE_LINE_COLOR } from "@/lib/categories.js";
import { fmtMoney, fmtMoneyShort } from "@/lib/format.js";

export interface ChartPoint {
  date: string;
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
  /** Low-cash floor: dotted danger line + red zones where breached. */
  threshold: number;
  overlays?: Overlay[];
  /** "Today" — start of the forecast; drawn as a marker. */
  todayLabel?: string;
}

const VBW = 900;
const VBH = 320;
const PAD = { top: 18, right: 18, bottom: 34, left: 62 };
const GRID = "rgba(19,19,19,0.07)";
const AXIS = "#7a7a7a";
const RED = "#b4342a";
const COND = "'Barlow Condensed', system-ui, sans-serif";

export function CashChart({ series, threshold, overlays = [], todayLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const plotW = VBW - PAD.left - PAD.right;
  const plotH = VBH - PAD.top - PAD.bottom;
  const n = series.length;
  if (n === 0) return null;

  const allVals = [
    ...series.map((p) => p.ending),
    ...overlays.flatMap((o) => o.points.map((p) => p.ending)),
    threshold,
    0,
  ];
  let yMin = Math.min(...allVals);
  let yMax = Math.max(...allVals);
  const spanRaw = yMax - yMin || 1;
  yMin -= spanRaw * 0.06;
  yMax += spanRaw * 0.08;

  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const baseY = PAD.top + plotH;

  // Step-after path: hold each level, then step at the next point.
  const stepLine = (pts: ChartPoint[]) => {
    let d = `M${x(0).toFixed(1)},${y(pts[0]!.ending).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L${x(i).toFixed(1)},${y(pts[i - 1]!.ending).toFixed(1)} L${x(i).toFixed(1)},${y(pts[i]!.ending).toFixed(1)}`;
    }
    return d;
  };
  const stepArea = (pts: ChartPoint[]) =>
    `${stepLine(pts)} L${x(pts.length - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);
  const labelStep = Math.max(1, Math.ceil(n / 7));

  const zeroInView = yMin < 0 && yMax > 0;
  const cashOutIdx = series.findIndex((p) => p.ending < 0);

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
            <stop offset="0%" stopColor={BASE_LINE_COLOR} stopOpacity="0.20" />
            <stop offset="100%" stopColor={BASE_LINE_COLOR} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* danger zone: everything below $0 */}
        {zeroInView && (
          <rect x={PAD.left} y={y(0)} width={plotW} height={Math.max(0, baseY - y(0))} fill={RED} fillOpacity={0.05} />
        )}

        {/* gridlines + y labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(v)} x2={VBW - PAD.right} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {fmtMoneyShort(v)}
            </text>
          </g>
        ))}

        {/* $0 reference line + boxed label */}
        {zeroInView && (
          <g>
            <line x1={PAD.left} y1={y(0)} x2={VBW - PAD.right} y2={y(0)} stroke="rgba(19,19,19,0.30)" strokeWidth={1.2} />
            <rect x={PAD.left - 48} y={y(0) - 11} width={40} height={22} rx={5} fill={RED} />
            <text x={PAD.left - 28} y={y(0) + 4} textAnchor="middle" fontSize={11.5} fill="#fff">
              $0
            </text>
          </g>
        )}

        {/* area + base step line */}
        <path d={stepArea(series)} fill="url(#cashFill)" />
        <path d={stepLine(series)} fill="none" stroke={BASE_LINE_COLOR} strokeWidth={2.2} strokeLinejoin="round" />

        {/* overlays */}
        {overlays.map((o) => (
          <path key={o.name} d={stepLine(o.points)} fill="none" stroke={o.color} strokeWidth={1.9} strokeDasharray="5 4" strokeLinejoin="round" />
        ))}

        {/* cash-out marker: first period the balance goes below $0 */}
        {cashOutIdx > 0 && (
          <g>
            <line x1={x(cashOutIdx)} y1={PAD.top} x2={x(cashOutIdx)} y2={baseY} stroke={RED} strokeWidth={1.2} strokeDasharray="4 4" strokeOpacity={0.85} />
            <text x={x(cashOutIdx) + 5} y={PAD.top + 3} fontSize={11} fill={RED} style={{ fontFamily: COND, fontWeight: 700, letterSpacing: ".08em" }}>
              CASH-OUT
            </text>
          </g>
        )}

        {/* today marker (start of forecast) */}
        <line x1={x(0)} y1={PAD.top - 4} x2={x(0)} y2={baseY} stroke={RED} strokeWidth={1.4} />
        {todayLabel && (
          <text x={x(0) + 5} y={PAD.top + 3} fontSize={11} fill={RED} style={{ fontFamily: COND, fontWeight: 700, letterSpacing: ".08em" }}>
            TODAY
          </text>
        )}

        {/* x labels */}
        {series.map((p, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={VBH - PAD.bottom + 18} textAnchor="middle" fontSize={10.5} fill={AXIS}>
              {p.label}
            </text>
          ) : null,
        )}

        {/* hover */}
        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={baseY} stroke="#16232b" strokeOpacity={0.18} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hp.ending)} r={4} fill={BASE_LINE_COLOR} stroke="#fff" strokeWidth={1.5} />
            {overlays.map((o) => {
              const pt = o.points[hover];
              return pt ? <circle key={o.name} cx={x(hover)} cy={y(pt.ending)} r={4} fill={o.color} stroke="#fff" strokeWidth={1.5} /> : null;
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
            background: "var(--bg-elev)",
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
          <div className="mono" style={{ color: BASE_LINE_COLOR }}>Base: {fmtMoney(hp.ending)}</div>
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
