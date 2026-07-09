"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { CashEvent } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * Invoices Due (AR) — QuickBooks sync bar + a ledger of open invoices with
 * per-invoice cash-flow controls: "In CF" (untick to exclude a dispute or
 * passthrough) and an expected-collection date override. Invoices are grouped
 * Overdue-first, then by due month, and filterable by status / searchable.
 */

type Filter = "all" | "overdue" | "current" | "excluded";
type Sort = "due" | "amount";

const RED = "var(--red)";
const BLUE = "#3565e3";
const SUBTLE = "var(--text-dim)";

interface Row {
  id: string;
  client: string;
  num: string;
  status: "overdue" | "current" | "excluded";
  due: string;
  amount: number;
  expected: string | null;
  inCF: boolean;
}

function splitMemo(memo: string): { client: string; num: string } {
  const m = memo.match(/^(.*?)\s*#(\S+)\s*$/);
  return m ? { client: m[1]!.trim(), num: m[2]! } : { client: memo, num: "" };
}
function monthFull(iso: string): string {
  const [y, mo] = iso.split("-").map(Number) as [number, number];
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][(mo || 1) - 1]} ${y}`;
}

const eyebrow: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: SUBTLE };

export function InvoicesAR() {
  const { syncedArRaw, adjustments, setAdjustment } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("due");
  const [q, setQ] = useState("");

  const rows: Row[] = useMemo(
    () =>
      (syncedArRaw ?? []).map((e: CashEvent) => {
        const id = e.id ?? "";
        const adj = adjustments[id] ?? {};
        const excluded = adj.excluded === true;
        const { client, num } = splitMemo(e.memo ?? "—");
        return {
          id,
          client,
          num,
          status: excluded ? "excluded" : e.category === "overdueAR" ? "overdue" : "current",
          due: e.originalDate ?? e.date,
          amount: e.amount,
          expected: adj.date ?? adj.payDate ?? null,
          inCF: !excluded,
        };
      }),
    [syncedArRaw, adjustments],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, overdue: 0, current: 0, excluded: 0 };
    rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  const list = useMemo(() => {
    let r = rows.filter((x) => filter === "all" || x.status === filter);
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((x) => `${x.client} ${x.num}`.toLowerCase().includes(s));
    }
    return r.slice().sort((a, b) => {
      if (sort === "amount") return b.amount - a.amount;
      const ao = a.status === "overdue" ? 0 : 1;
      const bo = b.status === "overdue" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.due.localeCompare(b.due);
    });
  }, [rows, filter, q, sort]);

  const inForecast = rows.filter((r) => r.inCF).reduce((s, r) => s + r.amount, 0);
  const excluded = rows.filter((r) => !r.inCF).reduce((s, r) => s + r.amount, 0);

  const groups = useMemo(() => {
    const gs: Array<{ key: string; label: string; overdue: boolean; rows: Row[]; sum: number }> = [];
    const idx: Record<string, number> = {};
    list.forEach((r) => {
      const key = r.status === "overdue" ? "__overdue" : monthFull(r.due);
      if (idx[key] === undefined) {
        idx[key] = gs.length;
        gs.push({ key, label: key === "__overdue" ? "Overdue · due now" : key, overdue: key === "__overdue", rows: [], sum: 0 });
      }
      const g = gs[idx[key]]!;
      g.rows.push(r);
      g.sum += r.amount;
    });
    return gs;
  }, [list]);

  const colGrid = "minmax(0,1fr) 104px 92px 172px 120px 44px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* AR card */}
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Summary tiles */}
        <div style={{ display: "flex", gap: 38, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Tile label="In cash flow" value={fmtMoney(inForecast)} color="var(--text)" />
          <Tile label="Excluded" value={fmtMoney(excluded)} color={RED} />
          <Tile label="Not invoiced" value="$0" color={SUBTLE} />
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>{counts.all} invoices</div>
            <div style={{ fontSize: 14, color: "#4a4a4a" }}>{list.length} shown</div>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Segmented
            options={[
              { v: "all", label: "All", count: counts.all },
              { v: "overdue", label: "Overdue", count: counts.overdue },
              { v: "current", label: "Current", count: counts.current },
              { v: "excluded", label: "Excluded", count: counts.excluded },
            ]}
            value={filter}
            onPick={setFilter}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...eyebrow, letterSpacing: ".12em" }}>Sort</span>
            <Segmented options={[{ v: "due", label: "Due" }, { v: "amount", label: "Amount" }]} value={sort} onPick={setSort} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 9, padding: "7px 12px", minWidth: 220 }}>
              <span style={{ color: SUBTLE, fontSize: 13 }}>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or invoice" style={{ border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text)", width: "100%" }} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 840 }}>
            <div style={{ display: "grid", gridTemplateColumns: colGrid, alignItems: "center", gap: 12, padding: "0 4px 10px", borderBottom: "1px solid var(--border)" }}>
              <div style={eyebrow}>Client / invoice</div>
              <div style={eyebrow}>Status</div>
              <div style={eyebrow}>Due</div>
              <div style={eyebrow}>Expected collection</div>
              <div style={{ ...eyebrow, textAlign: "right" }}>Amount</div>
              <div style={{ ...eyebrow, textAlign: "center" }}>In CF</div>
            </div>

            {groups.map((g) => (
              <div key={g.key}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "16px 4px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: g.overdue ? RED : "var(--text)" }}>{g.label}</span>
                    <span style={{ fontSize: 12, color: SUBTLE }}>{g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <span style={{ fontSize: 13, color: SUBTLE, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(g.sum)}</span>
                </div>
                {g.rows.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: colGrid, alignItems: "center", gap: 12, padding: "11px 4px", borderBottom: "1px solid rgba(19,19,19,0.05)", opacity: r.status === "excluded" ? 0.62 : 1 }}>
                    <div style={{ minWidth: 0, fontSize: 14.5, lineHeight: 1.35, color: r.status === "excluded" ? SUBTLE : "var(--text)" }}>
                      <span style={{ fontWeight: 700 }}>{r.client}</span>
                      {r.num && <span style={{ color: "var(--text-faint)" }}> #{r.num}</span>}
                    </div>
                    <div><StatusBadge status={r.status} /></div>
                    <div style={{ fontSize: 13.5, color: r.status === "excluded" ? SUBTLE : "#4a4a4a" }}>{fmtShortDate(r.due)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="date"
                        value={r.expected ?? ""}
                        onChange={(e) => setAdjustment(r.id, { date: e.target.value || null })}
                        disabled={r.status === "excluded"}
                        style={{ border: r.expected ? "1px solid var(--border)" : "1px solid transparent", borderRadius: 6, background: r.expected ? "#fff" : "transparent", fontSize: 12.5, color: r.expected ? "var(--text)" : "var(--text-faint)", padding: "5px 7px", width: 132, cursor: "pointer" }}
                      />
                      {r.expected && <button onClick={() => setAdjustment(r.id, { date: null })} title="Clear" style={{ border: "none", background: "transparent", color: SUBTLE, cursor: "pointer", padding: 2 }}>✕</button>}
                    </div>
                    <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 500, color: r.status === "excluded" ? SUBTLE : "var(--text)" }}>{fmtMoney(r.amount)}</div>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <input type="checkbox" checked={r.inCF} onChange={(e) => setAdjustment(r.id, { excluded: !e.target.checked })} style={{ width: 17, height: 17, accentColor: "var(--green)", cursor: "pointer" }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {list.length === 0 && (
              <div style={{ padding: "40px 4px", textAlign: "center", fontSize: 15, color: SUBTLE }}>
                {rows.length === 0 ? "No invoices synced yet — refresh from QuickBooks." : "No invoices match this view."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ ...eyebrow, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 30, lineHeight: 1, color, letterSpacing: ".004em" }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Row["status"] }) {
  const map = {
    overdue: { c: RED, b: "rgba(180,52,42,0.35)", bg: "rgba(180,52,42,0.06)", t: "Overdue" },
    current: { c: BLUE, b: "rgba(53,101,227,0.30)", bg: "rgba(53,101,227,0.05)", t: "Current" },
    excluded: { c: SUBTLE, b: "var(--border)", bg: "transparent", t: "Excluded" },
  }[status];
  return (
    <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: map.c, border: `1px solid ${map.b}`, background: map.bg, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>{map.t}</span>
  );
}

function Segmented<T extends string>({ options, value, onPick }: { options: Array<{ v: T; label: string; count?: number }>; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const a = o.v === value;
        return (
          <button key={o.v} onClick={() => onPick(o.v)} style={{ cursor: "pointer", borderRadius: 6, padding: "6px 12px", fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", background: a ? "#fff" : "transparent", color: a ? "var(--text)" : SUBTLE, border: a ? "1px solid var(--border)" : "1px solid transparent", boxShadow: a ? "0 1px 2px rgba(19,19,19,0.05)" : "none" }}>
            {o.label}
            {o.count != null && <span style={{ fontFamily: "var(--font-body)", fontWeight: 400, fontSize: 11, marginLeft: 6, color: a ? SUBTLE : "var(--text-faint)" }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
