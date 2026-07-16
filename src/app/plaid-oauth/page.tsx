"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { useStore } from "@/lib/data/store.js";
import { fetchAndApplyBankBalances } from "@/lib/integrations/plaid/apply.js";
import { PLAID_LINK_TOKEN_KEY } from "@/components/PlaidPanel.js";

/**
 * OAuth landing page. Institutions like Chase do a full-page redirect to their
 * site and back here (the registered Plaid redirect URI). We re-initialize Link
 * with the original token + the received redirect URL so it can finish, then
 * exchange, sync balances, apply them, and return to the app.
 */
export default function PlaidOAuthPage() {
  const router = useRouter();
  const { input, setInput } = useStore();
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("Finishing your bank connection…");

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem(PLAID_LINK_TOKEN_KEY));
    } catch {
      setToken(null);
    }
    setChecked(true);
  }, []);

  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined,
    onSuccess: async (publicToken, metadata) => {
      try {
        const ex = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution_name: metadata?.institution?.name,
          }),
        });
        if (!ex.ok) {
          setMessage("Couldn't finish connecting. Return to the app and try again.");
          return;
        }
        await fetch("/api/sync/bank", { method: "POST" });
        try {
          window.localStorage.removeItem(PLAID_LINK_TOKEN_KEY);
        } catch {
          /* ignore */
        }
        // Apply against the authoritative latest state; client-nav keeps the
        // store mounted so the write persists.
        await fetchAndApplyBankBalances(input.bankAccounts, setInput);
        router.replace("/");
      } catch {
        setMessage("Couldn't finish connecting. Return to the app and try again.");
      }
    },
    onExit: () => {
      router.replace("/");
    },
  });

  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 40 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Brains Cash Flow</h1>
        {checked && !token ? (
          <p className="muted">
            No bank connection in progress. <a href="/">Return to the app</a>.
          </p>
        ) : (
          <p className="muted">{message}</p>
        )}
      </div>
    </main>
  );
}
