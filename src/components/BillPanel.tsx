"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApReconciliation } from "@/lib/integrations/billdotcom/reconcile.js";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";

interface Status {
  configured: boolean;
  environment: string;
  lastSync: {
    syncedAt: string;
    apCount: number;
    apTotal: number;
    reconciliation: ApReconciliation | null;
  } | null;
}

export function BillPanel() {
  const { refreshBill } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/billdotcom/status", { cache: "no-store" });
      setStatus((await res.json()) as Status);
    } catch {
      setError("Couldn't load Bill.com status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/billdotcom", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Sync failed.");
      }
      await load();
      await refreshBill(); // push freshly-synced AP into the live forecast
    } catch {
      setError("Sync request failed.");
    } finally {
      setSyncing(false);
    }
  };

  const rec = status?.lastSync?.reconciliation ?? null;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 15, color: "var(--text)" }}>Bill.com sync</h2>
        <span className="chip neutral" style={{ marginLeft: 4 }}>{status?.environment ?? "sandbox"}</span>
        <div className="spacer" />
        <button className="btn sm primary" onClick={sync} disabled={syncing || !status?.configured}>
          {syncing ? "Syncing…" : "Refresh AP"}
        </button>
      </div>

      {!status ? (
        <div className="muted">Checking configuration…</div>
      ) : !status.configured ? (
        <div className="muted">
          Not configured yet. Add <code>BILLDOTCOM_DEV_KEY</code>, <code>BILLDOTCOM_ORG_ID</code>,{" "}
          <code>BILLDOTCOM_USERNAME</code>, and <code>BILLDOTCOM_PASSWORD</code> to <code>.env.local</code>.
          Bill.com is the AP source of truth; QuickBooks Bills validate it.
        </div>
      ) : !status.lastSync ? (
        <div className="muted">Configured. Click Refresh AP to pull open bills.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 24 }}>
            <Stat label="Last synced" value={new Date(status.lastSync.syncedAt).toLocaleString()} />
            <Stat label="AP pulled" value={`${status.lastSync.apCount} · ${fmtMoney(status.lastSync.apTotal)}`} />
          </div>
          {rec && (
            <div className={`alert ${rec.inSync ? "" : "warning"}`} style={{ marginTop: 12, ...(rec.inSync ? { background: "rgba(11,122,91,0.07)", border: "1px solid rgba(11,122,91,0.25)" } : {}) }}>
              <span className="ico">{rec.inSync ? "✅" : "🟡"}</span>
              <span>
                QuickBooks cross-check: Bill.com {fmtMoney(rec.billTotal)} ({rec.billCount}) vs QBO{" "}
                {fmtMoney(rec.qboTotal)} ({rec.qboCount}) —{" "}
                {rec.inSync ? "in sync." : `Δ ${fmtMoney(rec.delta)}. Investigate before trusting AP.`}
              </span>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="alert critical" style={{ marginTop: 10 }}>
          <span className="ico">🔴</span>
          <span>{error}</span>
        </div>
      )}
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
