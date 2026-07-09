"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/data/store.js";
import { fmtMoneyShort } from "@/lib/format.js";

/**
 * Compact sync indicator for the page header of the AR / AP tabs: a pill
 * showing the integration, last sync summary, and a Refresh button. Replaces
 * the old full-width sync bar.
 */

interface Lite {
  configured?: boolean;
  environment?: string;
  lastSync: {
    syncedAt: string;
    arCount?: number; arTotal?: number;
    apCount?: number; apTotal?: number;
    reconciliation?: { inSync: boolean; delta: number } | null;
  } | null;
}

function timeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function SyncPill({ kind }: { kind: "qbo" | "bill" }) {
  const { refreshQbo, refreshBill } = useStore();
  const [status, setStatus] = useState<Lite | null>(null);
  const [syncing, setSyncing] = useState(false);

  const cfg =
    kind === "qbo"
      ? { statusUrl: "/api/qbo/status", syncUrl: "/api/sync/qbo", refresh: refreshQbo, label: "QuickBooks", noun: "invoices" as const }
      : { statusUrl: "/api/billdotcom/status", syncUrl: "/api/sync/billdotcom", refresh: refreshBill, label: "Bill.com", noun: "bills" as const };

  const load = useCallback(async () => {
    try {
      setStatus((await (await fetch(cfg.statusUrl, { cache: "no-store" })).json()) as Lite);
    } catch {
      /* leave null */
    }
  }, [cfg.statusUrl]);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setSyncing(true);
    try {
      await fetch(cfg.syncUrl, { method: "POST" });
      await load();
      await cfg.refresh();
    } finally {
      setSyncing(false);
    }
  };

  const ls = status?.lastSync ?? null;
  const count = kind === "qbo" ? ls?.arCount : ls?.apCount;
  const total = kind === "qbo" ? ls?.arTotal : ls?.apTotal;
  const rec = ls?.reconciliation ?? null;
  const summary = ls
    ? `synced ${timeShort(ls.syncedAt)} · ${count ?? 0} ${cfg.noun} · ${fmtMoneyShort(total ?? 0)}${rec ? (rec.inSync ? " · QBO in sync" : ` · QBO Δ ${fmtMoneyShort(rec.delta)}`) : ""}`
    : "not synced yet";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 999, padding: "6px 8px 6px 13px" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: ls ? "var(--green)" : "var(--text-faint)", flex: "0 0 auto" }} />
      <span style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 12.5, letterSpacing: ".02em" }}>{cfg.label}</span>
      <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{summary}</span>
      <button
        onClick={refresh}
        disabled={syncing}
        style={{ fontFamily: "var(--font-cond)", fontWeight: 700, fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 999, cursor: "pointer", border: "none", background: "var(--green)", color: "#fff", flex: "0 0 auto", opacity: syncing ? 0.6 : 1 }}
      >
        {syncing ? "…" : "Refresh"}
      </button>
    </div>
  );
}
