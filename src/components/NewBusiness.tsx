"use client";

import { useState } from "react";
import { addMonths, isValidISODate, type Billing, type ForecastInput, type PipelineDeal } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * New Business — pipeline opportunities you can toggle on/off to see their
 * revenue flow through the forecast. This is a play feature, so there's no win
 * probability: an enabled deal contributes its billing schedule as-is.
 *
 * Cash recognition is a schedule of billings (projects usually bill in 3–4
 * installments over a few months). Each enabled billing lands as a receipt on
 * its date. A quick-split helper spreads a total across N monthly billings.
 *
 * Today the list is manual; the intent is to wire this to the CRM so open
 * opportunities show up ready to flip on ("Connect CRM" is a placeholder).
 */

function isOn(d: PipelineDeal): boolean {
  return d.enabled === true;
}
function dealTotal(d: PipelineDeal): number {
  return (d.billings ?? []).reduce((s, b) => s + (b.amount || 0), 0);
}

interface FillDraft {
  total: number;
  count: number;
  start: string;
}

export function NewBusiness() {
  const { input, setInput } = useStore();
  const deals = input.pipeline ?? [];
  const anchor = input.anchorDate;
  const [fill, setFill] = useState<Record<string, FillDraft>>({});
  // Which deals are expanded. Deals collapse by default so the list stays a
  // compact set of toggles; a freshly added deal opens so you can fill it in.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggleOpen = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  const write = (next: PipelineDeal[]) => setInput((prev: ForecastInput) => ({ ...prev, pipeline: next }));
  const update = (i: number, patch: Partial<PipelineDeal>) =>
    write(deals.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => write(deals.filter((_, idx) => idx !== i));
  const add = () => {
    const id = `deal-${Date.now()}`;
    setOpen((prev) => ({ ...prev, [id]: true }));
    write([...deals, { id, name: "", enabled: true, billings: [{ date: addMonths(anchor, 1), amount: 50_000 }] }]);
  };

  const setBillings = (i: number, billings: Billing[]) => update(i, { billings });
  const updateBilling = (i: number, bi: number, patch: Partial<Billing>) =>
    setBillings(i, (deals[i]!.billings ?? []).map((b, idx) => (idx === bi ? { ...b, ...patch } : b)));
  const addBilling = (i: number) => {
    const bs = deals[i]!.billings ?? [];
    const last = bs[bs.length - 1];
    const nextDate = last && isValidISODate(last.date) ? addMonths(last.date, 1) : addMonths(anchor, 1);
    setBillings(i, [...bs, { date: nextDate, amount: 0 }]);
  };
  const removeBilling = (i: number, bi: number) =>
    setBillings(i, (deals[i]!.billings ?? []).filter((_, idx) => idx !== bi));

  const draftFor = (d: PipelineDeal): FillDraft =>
    fill[d.id] ?? { total: dealTotal(d) || 100_000, count: d.billings?.length || 3, start: addMonths(anchor, 1) };
  const setDraft = (id: string, patch: Partial<FillDraft>) =>
    setFill((prev) => ({ ...prev, [id]: { ...draftFor(deals.find((d) => d.id === id)!), ...prev[id], ...patch } }));

  // Spread `total` across `count` equal monthly billings from `start`; the last
  // installment absorbs any rounding remainder so the schedule sums exactly.
  const generate = (i: number) => {
    const d = deals[i]!;
    const { total, count, start } = draftFor(d);
    const n = Math.max(1, Math.floor(count) || 1);
    if (!isValidISODate(start)) return;
    const per = Math.round(total / n);
    const billings: Billing[] = Array.from({ length: n }, (_, k) => ({
      date: addMonths(start, k),
      amount: k === n - 1 ? total - per * (n - 1) : per,
    }));
    setBillings(i, billings);
  };

  const enabled = deals.filter(isOn);
  const scheduledTotal = enabled.reduce((s, d) => s + dealTotal(d), 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>New Business</h2>
        <div className="spacer" />
        <span className="pill-total mono">{fmtMoney(scheduledTotal)} scheduled</span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Toggle opportunities on to flow their revenue into the forecast. Cash is recognized on a billing schedule —
        set each installment&apos;s date and amount, or use quick-split to spread a total across a few monthly billings.
        {enabled.length > 0 && ` ${enabled.length} on.`}
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

      {deals.map((d, i) => {
        const on = isOn(d);
        const bs = d.billings ?? [];
        const draft = draftFor(d);
        const isOpen = open[d.id] ?? false;
        const firstDate = bs.filter((b) => isValidISODate(b.date)).map((b) => b.date).sort()[0];
        return (
          <div
            key={d.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 10,
              opacity: on ? 1 : 0.6,
            }}
          >
            <div className="row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                title={on ? "Included in forecast" : "Excluded from forecast"}
              />
              <input
                value={d.name}
                placeholder="Opportunity name — e.g. New logo, Q3"
                onChange={(e) => update(i, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <span className="mono" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                {fmtMoney(dealTotal(d))}
              </span>
              <button
                className="btn sm ghost"
                onClick={() => toggleOpen(d.id)}
                title={isOpen ? "Collapse schedule" : "Edit schedule"}
                aria-expanded={isOpen}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <button className="btn sm ghost" onClick={() => remove(i)} title="Remove opportunity">
                ✕
              </button>
            </div>

            {!isOpen && (
              <div className="muted" style={{ paddingLeft: 26, fontSize: 12 }}>
                {bs.length === 0
                  ? "No billings — expand to add a schedule"
                  : `${bs.length} billing${bs.length === 1 ? "" : "s"}${firstDate ? ` · first ${fmtShortDate(firstDate)}` : ""}`}
              </div>
            )}

            {/* Billing schedule */}
            {isOpen && (
            <div style={{ paddingLeft: 26 }}>
              {bs.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr auto",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--text-dim)",
                    marginBottom: 4,
                  }}
                >
                  <span>Billing date</span>
                  <span>Amount</span>
                  <span />
                </div>
              )}
              {bs.map((b, bi) => (
                <div
                  key={bi}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 6 }}
                >
                  <input type="date" value={b.date} onChange={(e) => updateBilling(i, bi, { date: e.target.value })} />
                  <input
                    type="number"
                    step="1000"
                    value={b.amount}
                    onChange={(e) => updateBilling(i, bi, { amount: Number(e.target.value) })}
                  />
                  <button className="btn sm ghost" onClick={() => removeBilling(i, bi)} title="Remove billing">
                    ✕
                  </button>
                </div>
              ))}

              <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn sm ghost" onClick={() => addBilling(i)}>
                  + Billing
                </button>
                <span className="muted" style={{ margin: "0 4px" }}>
                  or quick-split
                </span>
                <input
                  type="number"
                  step="1000"
                  value={draft.total}
                  onChange={(e) => setDraft(d.id, { total: Number(e.target.value) })}
                  title="Total value"
                  style={{ width: 110 }}
                />
                <span className="muted">into</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={draft.count}
                  onChange={(e) => setDraft(d.id, { count: Number(e.target.value) })}
                  title="Number of billings"
                  style={{ width: 56 }}
                />
                <span className="muted">billings, monthly from</span>
                <input
                  type="date"
                  value={draft.start}
                  onChange={(e) => setDraft(d.id, { start: e.target.value })}
                  style={{ width: 150 }}
                />
                <button className="btn sm" onClick={() => generate(i)}>
                  Generate
                </button>
              </div>

              {on && bs.some((b) => isValidISODate(b.date)) && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  First cash {fmtShortDate(bs.filter((b) => isValidISODate(b.date)).map((b) => b.date).sort()[0]!)} ·{" "}
                  {bs.filter((b) => isValidISODate(b.date)).length} billing
                  {bs.filter((b) => isValidISODate(b.date)).length === 1 ? "" : "s"}
                </div>
              )}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
