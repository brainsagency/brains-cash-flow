"use client";

import { useEffect, useMemo, useState } from "react";
import type { CashCategory, CashEvent, RecurringFrequency, RecurringItem } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { vendorKey, vendorSummaries, type VendorSummary } from "@/lib/integrations/billdotcom/coverage.js";
import { fmtAxisLabel, fmtMoney, fmtShortDate } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";

type Dir = "out" | "in";
/** The cadence select folds "not recurring at all" in as one more option. */
type Repeats = RecurringFrequency | "once";

interface OWRow {
  id: string;
  direction: Dir; // out = withdrawal, in = reimbursement / cost-sharing inflow
  memo: string;
  amount: number;
  repeats: Repeats;
  /** One-off date, or the first occurrence of a recurring item. */
  startDate: string;
  /** Recurring last occurrence (optional; loans / fixed-term buyouts). */
  endDate?: string;
  /** Bill.com vendors whose real bills are this same money (see coverage.ts). */
  coveredByVendors?: string[];
  /** Derived: what those bills come to per month. Read-only — never persisted. */
  coveredMonths?: Record<string, number>;
}

// Money out lives on the manual `otherWithdrawals` disbursement line; money in
// (cost-sharing reimbursements, e.g. from Mass Culture) rides the manual
// `notInvoiced` receipt line — the one receipt category the QuickBooks sync
// doesn't overwrite, so a manual inflow survives a re-sync.
const OUT_CAT: CashCategory = "otherWithdrawals";
const IN_CAT: CashCategory = "notInvoiced";
const catOf = (d: Dir): CashCategory => (d === "in" ? IN_CAT : OUT_CAT);

/** Money in reads as a gain, money out as a drain — one hue each, everywhere. */
const HUE: Record<Dir, string> = { in: "var(--green)", out: "var(--red)" };

const REPEATS: Array<{ v: Repeats; label: string }> = [
  { v: "monthly", label: "Monthly" },
  { v: "semimonthly", label: "Twice a month" },
  { v: "biweekly", label: "Every two weeks" },
  { v: "weekly", label: "Weekly" },
  { v: "once", label: "One-off" },
];
const REPEATS_LABEL = (r: Repeats) => REPEATS.find((o) => o.v === r)?.label ?? "Monthly";

function newId(): string {
  try {
    return `ow_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `ow_${Math.floor(performance.now())}`;
  }
}

export function OtherWithdrawals() {
  const { input, setInput, syncedApRaw } = useStore();
  const anchor = input.anchorDate;
  const anchorMonth = anchor.slice(0, 7);
  const [editing, setEditing] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  // Vendors with open bills — the option list for linking a projection to the
  // real bills that stand in for it once the month arrives.
  const vendors = useMemo(() => vendorSummaries(syncedApRaw ?? []), [syncedApRaw]);

  // Derive the unified row list from both storage arrays (recurring first),
  // pulling both the outflow (otherWithdrawals) and inflow (notInvoiced) slices.
  const rows: OWRow[] = [
    ...(input.recurring ?? [])
      .filter((r) => r.category === OUT_CAT || r.category === IN_CAT)
      .map((r) => ({
        id: r.id ?? newId(),
        direction: (r.category === IN_CAT ? "in" : "out") as Dir,
        memo: r.memo ?? "",
        amount: r.amount,
        repeats: r.frequency as Repeats,
        startDate: r.startDate,
        endDate: r.endDate,
        coveredByVendors: r.coveredByVendors,
        coveredMonths: r.coveredMonths,
      })),
    ...(input.events ?? [])
      .filter((e) => e.category === OUT_CAT || e.category === IN_CAT)
      .map((e) => ({
        id: e.id ?? newId(),
        direction: (e.category === IN_CAT ? "in" : "out") as Dir,
        memo: e.memo ?? "",
        amount: e.amount,
        repeats: "once" as Repeats,
        startDate: e.date,
      })),
  ];

  const totalOut = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amount, 0);
  const totalIn = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amount, 0);
  const net = totalOut - totalIn; // net cash drain from these manual items
  const recurringCount = rows.filter((r) => r.repeats !== "once").length;

  // Keep a selection alive while editing: fall back to the first line whenever
  // the selected one is deleted, and clear it when the panel closes.
  const selected = rows.find((r) => r.id === selId) ?? null;
  useEffect(() => {
    if (!editing) return;
    if (!rows.some((r) => r.id === selId)) setSelId(rows[0]?.id ?? null);
  }, [editing, rows, selId]);

  // Persist: rebuild the otherWithdrawals + notInvoiced slices of events + recurring.
  const writeRows = (next: OWRow[]) =>
    setInput((prev) => {
      const keepEvents = (prev.events ?? []).filter((e) => e.category !== OUT_CAT && e.category !== IN_CAT);
      const keepRecurring = (prev.recurring ?? []).filter((r) => r.category !== OUT_CAT && r.category !== IN_CAT);
      const owEvents: CashEvent[] = next
        .filter((r) => r.repeats === "once")
        .map((r) => ({ id: r.id, category: catOf(r.direction), amount: r.amount, date: r.startDate, memo: r.memo }));
      const owRecurring: RecurringItem[] = next
        .filter((r) => r.repeats !== "once")
        .map((r) => ({
          id: r.id,
          category: catOf(r.direction),
          amount: r.amount,
          frequency: r.repeats as RecurringFrequency,
          startDate: r.startDate,
          memo: r.memo,
          ...(r.endDate ? { endDate: r.endDate } : {}),
          // `coveredMonths` is deliberately not written back: the store
          // recomputes it from the AP feed on every merge, and persisting a
          // stale copy would net out bills that are long since paid.
          ...(r.coveredByVendors?.length ? { coveredByVendors: r.coveredByVendors } : {}),
        }));
      return { ...prev, events: [...keepEvents, ...owEvents], recurring: [...keepRecurring, ...owRecurring] };
    });

  const update = (id: string, patch: Partial<OWRow>) =>
    writeRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => {
    writeRows(rows.filter((r) => r.id !== id));
    setSelId(rows.find((r) => r.id !== id)?.id ?? null);
  };
  const add = (direction: Dir) => {
    const id = newId();
    writeRows([...rows, { id, direction, memo: "", amount: 0, repeats: "monthly", startDate: anchor }]);
    setEditing(true);
    setSelId(id);
  };
  /** Clicking a line in the read view opens the editor on that line. */
  const openOn = (id: string) => {
    setSelId(id);
    setEditing(true);
  };

  return (
    <div className={`card ow-card${editing ? " editing" : ""}`}>
      <div className="ow-main">
        <div className="ow-head">
          <div>
            <h2 className="ow-title">Other Withdrawals &amp; Reimbursements</h2>
            <div className="ow-sub">
              {rows.length} line{rows.length === 1 ? "" : "s"} · {recurringCount} recurring · cash movements that
              aren&apos;t on the books
            </div>
          </div>
          <div className="ow-net">
            <span className="ow-eyebrow">{net < 0 ? "Net gain / occurrence" : "Net drain / occurrence"}</span>
            <span className="ow-net-val mono">{fmtMoney(Math.abs(net))}</span>
          </div>
        </div>

        <div className="ow-totals">
          <div className="ow-total">
            <span className="ow-eyebrow" style={{ color: HUE.out }}>Money out</span>
            <span className="mono">{fmtMoney(totalOut)}</span>
          </div>
          <div className="ow-total">
            <span className="ow-eyebrow" style={{ color: HUE.in }}>Money in</span>
            <span className="mono">{fmtMoney(totalIn)}</span>
          </div>
        </div>

        <div className="ow-list">
          {rows.length === 0 && (
            <div className="ow-empty muted">Nothing yet — add your first line below.</div>
          )}
          {rows.map((r) => {
            const covered = coverageNote(r, anchorMonth);
            return (
              <button
                key={r.id}
                className={`ow-line${editing && r.id === selId ? " selected" : ""}`}
                onClick={() => openOn(r.id)}
                title={editing ? "Edit this line" : "Open the editor on this line"}
              >
                <span className="ow-spine" style={{ background: HUE[r.direction] }} />
                <span className="ow-line-body">
                  <span className="ow-line-desc">{r.memo || <span className="muted">Unlabeled</span>}</span>
                  <span className="ow-line-meta">{describe(r)}</span>
                  {covered && (
                    <span className="ow-coverage">
                      <span className="chip info">Netted against bills</span>
                      <span>{covered}</span>
                    </span>
                  )}
                </span>
                <span className="ow-line-amt mono" style={{ color: HUE[r.direction] }}>
                  {r.direction === "in" ? "+" : "−"}
                  {fmtMoney(r.amount, { cents: r.amount % 1 !== 0 })}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ow-foot">
          {editing ? (
            <>
              <div className="ow-add">
                <button className="btn sm" onClick={() => add("out")}>+ Money out</button>
                <button className="btn sm ghost" onClick={() => add("in")}>+ Money in</button>
              </div>
              <button className="btn sm primary" onClick={() => setEditing(false)}>Done</button>
            </>
          ) : (
            <>
              <div className="ow-add" />
              {rows.length === 0 ? (
                <button className="btn sm" onClick={() => add("out")}>+ Add withdrawal</button>
              ) : (
                <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && selected && (
        <div className="ow-editor">
          <span className="ow-eyebrow">Editing</span>

          <label className="ow-field">
            Description
            <input
              value={selected.memo}
              placeholder={selected.direction === "in" ? "e.g. MC payroll reimbursement" : "e.g. Owner distribution"}
              onChange={(e) => update(selected.id, { memo: e.target.value })}
            />
          </label>

          <label className="ow-field">
            {selected.repeats === "once" ? "Amount" : "Amount per occurrence"}
            <MoneyInput value={selected.amount} onChange={(n) => update(selected.id, { amount: n })} />
          </label>

          <div className="ow-field">
            <span>Direction</span>
            <div className="ow-toggle">
              {(["out", "in"] as Dir[]).map((d) => (
                <button
                  key={d}
                  className={selected.direction === d ? "on" : ""}
                  style={selected.direction === d ? { background: HUE[d], borderColor: HUE[d] } : undefined}
                  onClick={() => update(selected.id, { direction: d })}
                >
                  {d === "out" ? "Money out" : "Money in"}
                </button>
              ))}
            </div>
          </div>

          <label className="ow-field">
            Repeats
            <select
              value={selected.repeats}
              onChange={(e) => update(selected.id, { repeats: e.target.value as Repeats })}
            >
              {REPEATS.map((o) => (
                <option key={o.v} value={o.v}>{o.label}</option>
              ))}
            </select>
          </label>

          <div className="ow-dates">
            <label className="ow-field">
              {selected.repeats === "once" ? (selected.direction === "in" ? "Funds in" : "Funds out") : "Starting"}
              <input
                type="date"
                value={selected.startDate}
                onChange={(e) => update(selected.id, { startDate: e.target.value })}
              />
            </label>
            {selected.repeats !== "once" && (
              <label className="ow-field">
                Ends (optional)
                <input
                  type="date"
                  min={selected.startDate}
                  value={selected.endDate ?? ""}
                  onChange={(e) => update(selected.id, { endDate: e.target.value || undefined })}
                />
              </label>
            )}
          </div>

          {selected.repeats !== "once" && selected.direction === "out" && (
            <VendorCoverage
              selected={selected.coveredByVendors ?? []}
              vendors={vendors}
              onChange={(next) => update(selected.id, { coveredByVendors: next })}
            />
          )}

          <p className="ow-hint">{hintFor(selected)}</p>

          <button className="btn sm ow-remove" onClick={() => remove(selected.id)}>
            Remove line
          </button>
        </div>
      )}
    </div>
  );
}

/** The line's schedule as a sentence: what repeats, from when, until when. */
function describe(r: OWRow): string {
  if (r.repeats === "once") return `One-off on ${fmtShortDate(r.startDate)}`;
  const ends = r.endDate ? ` until ${fmtShortDate(r.endDate)}` : " · no end date";
  return `${REPEATS_LABEL(r.repeats)} from ${fmtShortDate(r.startDate)}${ends}`;
}

/** Plain-language reminder of how the selected line reaches the projection. */
function hintFor(r: OWRow): string {
  const side = r.direction === "in" ? "money in" : "money out";
  if (r.repeats === "once") return `Hits the projection once, on ${fmtShortDate(r.startDate)}.`;
  return `Counts ${fmtMoney(r.amount)} toward the ${side} total each occurrence.`;
}

/**
 * Occurrences × per-occurrence amount for one calendar month, where the cadence
 * makes that a fixed number. Weekly and biweekly items land 4 or 5 times
 * depending on the month, so there's no single figure to compare bills against.
 */
function monthlyProjected(r: OWRow): number | null {
  if (r.repeats === "monthly") return r.amount;
  if (r.repeats === "semimonthly") return r.amount * 2;
  return null;
}

/**
 * What the linked bills already cover, month by month, from the current month
 * on — the plain-language version of the deduction the engine applies.
 */
function coverageNote(r: OWRow, fromMonth: string): string | null {
  const months = Object.entries(r.coveredMonths ?? {})
    .filter(([m]) => m >= fromMonth)
    .sort(([a], [b]) => a.localeCompare(b));
  if (months.length === 0) return null;
  const projected = monthlyProjected(r);
  const shown = months.slice(0, 2).map(([month, billed]) => {
    const label = fmtAxisLabel(`${month}-01`, "month");
    if (projected === null) return `${label} ${fmtMoney(billed)} billed`;
    const gap = projected - billed;
    return gap > 0.005
      ? `${label} ${fmtMoney(billed)} billed + ${fmtMoney(gap)} projected`
      : `${label} ${fmtMoney(billed)} billed, projection off`;
  });
  const more = months.length - shown.length;
  return shown.join(" · ") + (more > 0 ? ` · ${more} more month${more === 1 ? "" : "s"}` : "");
}

/**
 * Link a recurring withdrawal to the vendors whose real bills are the same
 * money. Anything linked here is netted out of the projection month by month,
 * so the near term runs on the actual bills and the projection carries the tail
 * — no more un-ticking the same bill every time Bill.com issues it.
 */
function VendorCoverage({
  selected,
  vendors,
  onChange,
}: {
  selected: string[];
  vendors: VendorSummary[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const keys = new Set(selected.map(vendorKey));
  const toggle = (vendor: string) =>
    onChange(
      keys.has(vendorKey(vendor))
        ? selected.filter((v) => vendorKey(v) !== vendorKey(vendor))
        : [...selected, vendor],
    );
  const list = q.trim()
    ? vendors.filter((v) => v.vendor.toLowerCase().includes(q.trim().toLowerCase()))
    : vendors;

  return (
    <div className="ow-field ow-link">
      <span>Covered by bills from</span>
      <div className="ow-link-chips">
        {selected.map((vendor) => (
          <button key={vendor} className="chip info ow-chip" onClick={() => toggle(vendor)} title="Unlink">
            {vendor} <span aria-hidden>✕</span>
          </button>
        ))}
        {vendors.length > 0 ? (
          <button className="btn sm ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Done" : selected.length ? "+ Add" : "+ Link vendor"}
          </button>
        ) : (
          <span className="muted">No open bills synced.</span>
        )}
      </div>
      {selected.length === 0 && !open && vendors.length > 0 && (
        <span className="ow-hint">Nothing linked — this line projects in full.</span>
      )}
      {open && (
        <div className="ow-link-list">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor" />
          <div className="ow-link-options">
            {list.map((v) => (
              <label key={v.vendor}>
                <input type="checkbox" checked={keys.has(vendorKey(v.vendor))} onChange={() => toggle(v.vendor)} />
                <span className="ow-link-vendor">{v.vendor}</span>
                <span className="muted">
                  {v.bills} · {fmtMoney(v.total)}
                </span>
              </label>
            ))}
            {list.length === 0 && <div className="muted">No vendor matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
