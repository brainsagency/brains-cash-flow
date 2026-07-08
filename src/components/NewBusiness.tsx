"use client";

import { addDays, isValidISODate, type ForecastInput, type PipelineDeal } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * New Business — pipeline opportunities you can toggle on/off to see their
 * probability-weighted revenue flow through the forecast. Each enabled deal
 * lands as a receipt of `value × win%` on `expected close + collection lag`.
 *
 * Today the list is manual (add your own to play with potential revenue). The
 * intent is to wire this to the CRM so open opportunities show up here ready to
 * flip on; until then "Connect CRM" is a placeholder.
 */

/** A deal counts when explicitly enabled (the panel always sets it explicitly). */
function isOn(d: PipelineDeal): boolean {
  return d.enabled === true;
}

function weighted(d: PipelineDeal): number {
  return d.value * Math.max(0, Math.min(1, d.probability || 0));
}

export function NewBusiness() {
  const { input, setInput } = useStore();
  const deals = input.pipeline ?? [];
  const anchor = input.anchorDate;

  const write = (next: PipelineDeal[]) => setInput((prev: ForecastInput) => ({ ...prev, pipeline: next }));
  const update = (i: number, patch: Partial<PipelineDeal>) =>
    write(deals.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => write(deals.filter((_, idx) => idx !== i));
  const add = () =>
    write([
      ...deals,
      {
        id: `deal-${Date.now()}`,
        name: "",
        value: 100_000,
        probability: 0.5,
        expectedCloseDate: addDays(anchor, 30),
        collectionLagDays: 30,
        enabled: true,
      },
    ]);

  const enabled = deals.filter(isOn);
  const weightedTotal = enabled.reduce((s, d) => s + weighted(d), 0);
  const grossTotal = enabled.reduce((s, d) => s + d.value, 0);

  const COLS = "auto 1.7fr 1fr 0.7fr 1.1fr 0.8fr 1.1fr auto";

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>New Business</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(weightedTotal)} weighted</span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Toggle opportunities on to flow their <b>probability-weighted</b> revenue into the forecast — each enabled deal
        lands as {"value × win%"} on its expected close date plus collection lag.{" "}
        {enabled.length > 0 && (
          <>
            {enabled.length} on ·{" "}
            <span className="mono">{fmtMoney(grossTotal)}</span> gross pipeline.
          </>
        )}
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button className="btn sm ghost" disabled title="CRM sync coming soon">
          Connect CRM (soon)
        </button>
        <button className="btn sm" onClick={add}>
          + Add opportunity
        </button>
      </div>

      {deals.length === 0 && (
        <div className="muted">No opportunities yet — add one above to model potential new revenue.</div>
      )}

      {deals.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              gap: 8,
              marginBottom: 6,
              fontSize: 12,
              color: "var(--text-dim)",
              alignItems: "end",
            }}
          >
            <span>On</span>
            <span>Opportunity</span>
            <span>Value</span>
            <span>Win %</span>
            <span>Expected close</span>
            <span>Lag (days)</span>
            <span>Expected cash</span>
            <span />
          </div>

          {deals.map((d, i) => {
            const on = isOn(d);
            const validDate = isValidISODate(d.expectedCloseDate);
            const cashDate = validDate ? addDays(d.expectedCloseDate, d.collectionLagDays || 0) : null;
            return (
              <div
                key={d.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 8,
                  opacity: on ? 1 : 0.55,
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                  title={on ? "Included in forecast" : "Excluded from forecast"}
                />
                <input value={d.name} placeholder="e.g. New logo — Q3" onChange={(e) => update(i, { name: e.target.value })} />
                <input
                  type="number"
                  step="1000"
                  value={d.value}
                  onChange={(e) => update(i, { value: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round((d.probability || 0) * 100)}
                  onChange={(e) => update(i, { probability: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })}
                />
                <input
                  type="date"
                  value={d.expectedCloseDate}
                  onChange={(e) => update(i, { expectedCloseDate: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  value={d.collectionLagDays}
                  onChange={(e) => update(i, { collectionLagDays: Number(e.target.value) })}
                />
                <span className="mono" style={{ fontSize: 13 }}>
                  {fmtMoney(weighted(d))}
                  {cashDate && <span className="muted"> · {fmtShortDate(cashDate)}</span>}
                </span>
                <button className="btn sm ghost" onClick={() => remove(i)} title="Remove">
                  ✕
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
