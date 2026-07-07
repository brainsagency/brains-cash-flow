"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";

interface Status {
  configured: boolean;
  connected: boolean;
  environment: string;
  realmId: string | null;
  lastSync: { syncedAt: string; arCount: number; apCount: number; arTotal: number; apTotal: number } | null;
}

export function QboPanel() {
  const { refreshQbo } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/qbo/status", { cache: "no-store" });
      setStatus((await res.json()) as Status);
    } catch {
      setError("Couldn't load QuickBooks status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/qbo", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Sync failed.");
      }
      await load();
      await refreshQbo(); // push freshly-synced AR into the live forecast
    } catch {
      setError("Sync request failed.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>QuickBooks sync</h2>
        <span className="chip neutral" style={{ marginLeft: 4 }}>{status?.environment ?? "sandbox"}</span>
        <div className="spacer" />
        {status?.connected ? (
          <button className="btn sm primary" onClick={refresh} disabled={syncing}>
            {syncing ? "Syncing…" : "Refresh AR"}
          </button>
        ) : (
          <a className={`btn sm primary ${status?.configured ? "" : "ghost"}`} href="/api/connect/qbo/start">
            Connect QuickBooks
          </a>
        )}
      </div>

      {!status ? (
        <div className="muted">Checking connection…</div>
      ) : !status.configured ? (
        <div className="muted">
          Not configured yet. Add <code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code>, and{" "}
          <code>QBO_REDIRECT_URI</code> to <code>.env.local</code>, then connect. Pulls open invoices as AR (and
          Bills for validation).
        </div>
      ) : !status.connected ? (
        <div className="muted">Not connected. Click Connect QuickBooks to authorize the {status.environment} company.</div>
      ) : status.lastSync ? (
        <div className="row" style={{ gap: 24 }}>
          <Stat label="Last synced" value={new Date(status.lastSync.syncedAt).toLocaleString()} />
          <Stat label="AR pulled" value={`${status.lastSync.arCount} · ${fmtMoney(status.lastSync.arTotal)}`} />
          <Stat label="AP (validation)" value={`${status.lastSync.apCount} · ${fmtMoney(status.lastSync.apTotal)}`} />
          <Stat label="Company (realm)" value={status.realmId ?? "—"} />
        </div>
      ) : (
        <div className="muted">Connected. Click Refresh AR to pull open invoices.</div>
      )}

      {error && <div className="alert critical" style={{ marginTop: 10 }}><span className="ico">🔴</span><span>{error}</span></div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}
