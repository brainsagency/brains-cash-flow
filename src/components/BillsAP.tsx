"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { CashEvent } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney, fmtShortDate } from "@/lib/format.js";

/**
 * Bills to Pay (AP) — Bill.com sync bar (with the QuickBooks cross-check) + a
 * ledger of open bills with per-bill controls: "In CF" (untick a production /
 * passthrough bill) and a planned-pay-date override. Grouped by due month,
 * filterable by status, searchable.
 */

interface Reconciliation {
  inSync: boolean;
  billTotal: number;
  billCount: number;
  qboTotal: number;
  qboCount: number;
  delta: number;
}
interface BillStatus {
  configured: boolean;
  environment: string;
  lastSync: { syncedAt: string; apCount: number; apTotal: number; reconciliation: Reconciliation | null } | null;
}

type Filter = "all" | "scheduled" | "excluded";
type Sort = "due" | "amount";

const RED = "var(--red)";
const BLUE = "#3565e3";
const PINK = "#c0507a";
const SUBTLE = "var(--text-dim)";

interface Row {
  id: string;
  vendor: string;
  num: string;
  status: "scheduled" | "excluded";
  due: string;
  amount: number;
  planned: string | null;
  inCF: boolean;
}

function splitMemo(memo: string): { vendor: string; num: string } {
  const m = memo.match(/^(.*?)\s*#(\S+)\s*$/);
  return m ? { vendor: m[1]!.trim(), num: m[2]! } : { vendor: memo, num: "" };
}
function monthFull(iso: string): string {
  const [y, mo] = iso.split("-").map(Number) as [number, number];
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][(mo || 1) - 1]} ${y}`;
}
function timeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const eyebrow: CSSProperties = { fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: SUBTLE };

export function BillsAP() {
  const { syncedApRaw, adjustments, setAdjustment, refreshBill } = useStore();
  const [status, setStatus] = useState<BillStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("due");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billdotcom/status", { cache: "no-store" });
      setStatus((await res.json()) as BillStatus);
    } catch {
      /* leave null */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setSyncing(true);
    try {
      await fetch("/api/sync/billdotcom", { method: "POST" });
      await load();
      await refreshBill();
    } finally {
      setSyncing(false);
    }
  };

  const rows: Row[] = useMemo(
    () =>
      (syncedApRaw ?? []).map((e: CashEvent) => {
        const id = e.id ?? "";
        const adj = adjustments[id] ?? {};
        const excluded = adj.excluded === true;
        const { vendor, num } = splitMemo(e.memo ?? "—");
        return {
          id,
          vendor,
          num,
          status: excluded ? "excluded" : "scheduled",
          due: e.originalDate ?? e.date,
          amount: e.amount,
          planned: adj.date ?? adj.payDate ?? null,
          inCF: !excluded,
        };
      }),
    [syncedApRaw, adjustments],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, scheduled: 0, excluded: 0 };
    rows.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  const list = useMemo(() => {
    let r = rows.filter((x) => filter === "all" || x.status === filter);
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((x) => `${x.vendor} ${x.num}`.toLowerCase().includes(s));
    }
    return r.slice().sort((a, b) => (sort === "amount" ? b.amount - a.amount : a.due.localeCompare(b.due)));
  }, [rows, filter, q, sort]);

  const inForecast = rows.filter((r) => r.inCF).reduce((s, r) => s + r.amount, 0);
  const excluded = rows.filter((r) => !r.inCF).reduce((s, r) => s + r.amount, 0);

  const groups = useMemo(() => {
    const gs: Array<{ key: string; rows: Row[]; sum: number }> = [];
    const idx: Record<string, number> = {};
    list.forEach((r) => {
      const key = monthFull(r.due);
      if (idx[key] === undefined) {
        idx[key] = gs.length;
        gs.push({ key, rows: [], sum: 0 });
      }
      const g = gs[idx[key]]!;
      g.rows.push(r);
      g.sum += r.amount;
    });
    return gs;
  }, [list]);

  const rec = status?.lastSync?.reconciliation ?? null;
  const syncText = status?.lastSync
    ? `Synced ${timeShort(status.lastSync.syncedAt)} · ${status.lastSync.apCount} bills · ${fmtMoney(status.lastSync.apTotal)} pulled${rec ? ` · ${rec.inSync ? "QBO cross-check in sync" : `QBO Δ ${fmtMoney(rec.delta)}`}` : ""}`
    : status?.configured ? "Configured — refresh to pull bills" : "Not configured";

  const colGrid = "minmax(0,1fr) 108px 92px 200px 110px 44px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Sync bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 14, letterSpacing: ".02em" }}>Bill.com sync</span>
          <span style={{ ...eyebrow, fontSize: 10, letterSpacing: ".12em", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px", textTransform: "capitalize" }}>{status?.environment ?? "…"}</span>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: status?.lastSync ? "var(--green)" : "var(--text-faint)", display: "inline-block" }} />
          <span style={{ fontSize: 13, color: "#4a4a4a" }}>{syncText}</span>
        </div>
        <button onClick={refresh} disabled={syncing || !status?.configured} style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--green)", color: "#fff", cursor: "pointer", opacity: syncing || !status?.configured ? 0.6 : 1 }}>{syncing ? "Syncing…" : "Refresh AP"}</button>
      </div>

      {/* AP card */}
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 17, letterSpacing: ".02em", marginBottom: 14 }}>Accounts Payable</div>
            <div style={{ display: "flex", gap: 38, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Tile label="In cash flow" value={fmtMoney(inForecast)} color="var(--text)" />
              <Tile label="Excluded" value={fmtMoney(excluded)} color={RED} />
              <Tile label="Estimate" value="$0" color={SUBTLE} />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>{counts.all} bills</div>
            <div style={{ fontSize: 14, color: "#4a4a4a" }}>{list.length} shown</div>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Segmented
            options={[
              { v: "all", label: "All", count: counts.all },
              { v: "scheduled", label: "Scheduled", count: counts.scheduled },
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
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor or bill" style={{ border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text)", width: "100%" }} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: "grid", gridTemplateColumns: colGrid, alignItems: "center", gap: 12, padding: "0 4px 10px", borderBottom: "1px solid var(--border)" }}>
              <div style={eyebrow}>Vendor / bill</div>
              <div style={eyebrow}>Status</div>
              <div style={eyebrow}>Due</div>
              <div style={eyebrow}>Planned pay date</div>
              <div style={{ ...eyebrow, textAlign: "right" }}>Amount</div>
              <div style={{ ...eyebrow, textAlign: "center" }}>In CF</div>
            </div>

            {groups.map((g) => (
              <div key={g.key}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "16px 4px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text)" }}>{g.key}</span>
                    <span style={{ fontSize: 12, color: SUBTLE }}>{g.rows.length} bill{g.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <span style={{ fontSize: 13, color: SUBTLE, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(g.sum)}</span>
                </div>
                {g.rows.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: colGrid, alignItems: "center", gap: 12, padding: "11px 4px", borderBottom: "1px solid rgba(19,19,19,0.05)", opacity: r.status === "excluded" ? 0.62 : 1 }}>
                    <div style={{ minWidth: 0, fontSize: 14.5, lineHeight: 1.35, color: r.status === "excluded" ? SUBTLE : "var(--text)" }}>
                      <span style={{ fontWeight: 700 }}>{r.vendor}</span>
                      {r.num && <span style={{ color: "var(--text-faint)" }}> #{r.num}</span>}
                    </div>
                    <div><StatusBadge status={r.status} /></div>
                    <div style={{ fontSize: 13.5, color: r.status === "excluded" ? SUBTLE : "#4a4a4a" }}>{fmtShortDate(r.due)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="date"
                        value={r.planned ?? ""}
                        onChange={(e) => setAdjustment(r.id, { date: e.target.value || null })}
                        disabled={r.status === "excluded"}
                        style={{ border: r.planned ? "1px solid var(--border)" : "1px solid transparent", borderRadius: 6, background: r.planned ? "#fff" : "transparent", fontSize: 12.5, color: r.planned ? "var(--text)" : "var(--text-faint)", padding: "5px 7px", width: 150, cursor: r.status === "excluded" ? "default" : "pointer" }}
                      />
                      {r.planned && r.status !== "excluded" && <button onClick={() => setAdjustment(r.id, { date: null })} title="Clear" style={{ border: "none", background: "transparent", color: SUBTLE, cursor: "pointer", padding: 2 }}>✕</button>}
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
                {rows.length === 0 ? "No bills synced yet — refresh from Bill.com." : "No bills match this view."}
              </div>
            )}
          </div>
        </div>

        <p style={{ fontSize: 13, color: SUBTLE, lineHeight: 1.55, margin: "2px 0 0" }}>
          Untick <b style={{ color: "#4a4a4a" }}>In CF</b> to keep a bill out of the forecast (e.g. production / passthrough for the sister company). Set a planned pay date when you&apos;ll pay later than the due date — the forecast uses your date.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ ...eyebrow, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 28, lineHeight: 1, color, letterSpacing: ".004em" }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Row["status"] }) {
  const map = {
    scheduled: { c: BLUE, b: "rgba(53,101,227,0.30)", bg: "rgba(53,101,227,0.05)", t: "Scheduled" },
    excluded: { c: PINK, b: "rgba(192,80,122,0.35)", bg: "rgba(192,80,122,0.05)", t: "Excluded" },
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
