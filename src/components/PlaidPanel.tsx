"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useStore } from "@/lib/data/store.js";
import { fmtMoney } from "@/lib/format.js";
import { fetchAndApplyBankBalances, type ApplySummary } from "@/lib/integrations/plaid/apply.js";

/** localStorage key used to resume Link after an OAuth (Chase, etc.) redirect. */
export const PLAID_LINK_TOKEN_KEY = "plaid_link_token";

interface Status {
  configured: boolean;
  connected: boolean;
  environment: string;
  connectedAt: string | null;
  lastSync: { syncedAt: string; accountCount: number } | null;
}

/**
 * Bank-balance sync via Plaid. Connect once with Plaid Link, then "Sync
 * balances" pulls live balances and writes them into the tracked accounts,
 * matched by last-four (mask), stamped as-of now. That clears the reconcile
 * banner without any manual entry.
 */
export function PlaidPanel() {
  const { input, setInput } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ApplySummary | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/plaid/status", { cache: "no-store" });
      setStatus((await res.json()) as Status);
    } catch {
      setError("Couldn't load bank connection status.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Pull balances and apply them to the tracked accounts by mask.
  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/bank", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Sync failed.");
        return;
      }
      setSummary(await fetchAndApplyBankBalances(input.bankAccounts, setInput));
      await loadStatus();
    } catch {
      setError("Sync request failed.");
    } finally {
      setBusy(false);
    }
  }, [input.bankAccounts, setInput, loadStatus]);

  // Returning from an OAuth bank (e.g. Chase), /plaid-oauth finishes the connect
  // and sync server-side, then sends us back with ?bank=synced — apply it here.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("bank") !== "synced") return;
    url.searchParams.delete("bank");
    window.history.replaceState({}, "", url.toString());
    void (async () => {
      setSummary(await fetchAndApplyBankBalances(input.bankAccounts, setInput));
      await loadStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setError(body.error ?? "Couldn't finish connecting.");
          return;
        }
        await loadStatus();
        await sync(); // immediately pull balances on first connect
      } catch {
        setError("Couldn't finish connecting.");
      } finally {
        setBusy(false);
      }
    },
  });

  // Open Link as soon as we have a token and the widget is ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const connect = async () => {
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Couldn't start Plaid Link.");
        return;
      }
      const { linkToken: token } = (await res.json()) as { linkToken: string };
      // Stash for the OAuth resume page (Chase et al. do a full-page redirect).
      try {
        window.localStorage.setItem(PLAID_LINK_TOKEN_KEY, token);
      } catch {
        /* private mode / storage disabled — non-OAuth banks still work */
      }
      setLinkToken(token);
    } catch {
      setError("Couldn't start Plaid Link.");
    }
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(19,19,19,0.08)" }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>Bank sync (Plaid)</div>
        <span className="chip neutral" style={{ marginLeft: 6 }}>{status?.environment ?? "sandbox"}</span>
        <div className="spacer" />
        {status?.connected ? (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={connect} disabled={busy} title="Relink or connect a different bank">
              Reconnect
            </button>
            <button className="btn sm primary" onClick={sync} disabled={busy}>
              {busy ? "Syncing…" : "Sync balances"}
            </button>
          </div>
        ) : (
          <button className={`btn sm primary ${status?.configured ? "" : "ghost"}`} onClick={connect} disabled={busy || !status?.configured}>
            Connect bank
          </button>
        )}
      </div>

      {!status ? (
        <div className="muted">Checking bank connection…</div>
      ) : !status.configured ? (
        <div className="muted">
          Not configured yet. Add <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code>, and{" "}
          <code>PLAID_ENV</code> to <code>.env.local</code>, then connect. Balances match your accounts by last-four.
        </div>
      ) : !status.connected ? (
        <div className="muted">
          Not connected. Click <b>Connect bank</b> to link your accounts — balances then fill in by last-four.
        </div>
      ) : (
        <div className="muted">
          Connected{status.lastSync ? ` · last synced ${new Date(status.lastSync.syncedAt).toLocaleString()}` : ""}.
          Set each account&apos;s last-four above so balances match on sync.
        </div>
      )}

      {summary && (
        <div className="muted" style={{ marginTop: 8 }}>
          Updated <b>{summary.matched}</b> balance{summary.matched === 1 ? "" : "s"} by last-four.
          {summary.unmatched.length > 0 && (
            <>
              {" "}Unmatched: {summary.unmatched.map((u) => `${u.name}${u.mask ? ` …${u.mask}` : ""} (${fmtMoney(u.current ?? u.available ?? 0)})`).join(", ")}
              . Add the last-four to a tracked account to include it.
            </>
          )}
        </div>
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
