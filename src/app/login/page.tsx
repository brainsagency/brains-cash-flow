"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client.js";

const ERROR_COPY: Record<string, string> = {
  denied: "That account isn't authorized for this app. Contact an admin to be added.",
  auth: "Sign-in didn't complete. Please try again.",
};

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read ?error= from the URL without useSearchParams (avoids a Suspense
  // boundary requirement for this client page).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(ERROR_COPY[code] ?? "Something went wrong. Please try again.");
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError("Couldn't reach Google sign-in. Please try again.");
      setBusy(false);
    }
    // On success the browser is redirected to Google, so no further work here.
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ padding: 0, marginBottom: 8, gap: 10, display: "flex", alignItems: "center" }}>
          <span aria-hidden style={{ width: 30, height: 30, borderRadius: "50%", background: "#131313", color: "#F9F7E9", display: "grid", placeItems: "center", fontFamily: "var(--font-disp)", fontWeight: 700, fontSize: 15 }}>B</span>
          <span style={{ fontFamily: "var(--font-disp)", fontWeight: 300, fontSize: 18 }}>Brains Cash Flow</span>
        </div>
        <p className="muted" style={{ margin: "0 0 18px" }}>Sign in with your Brains Google account.</p>

        {error && (
          <div className="alert critical" style={{ marginBottom: 14 }}>
            <span className="ico">🔴</span>
            <span>{error}</span>
          </div>
        )}

        <button
          className="btn"
          onClick={signIn}
          disabled={busy}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 16px", fontWeight: 600 }}
        >
          <GoogleG />
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden style={{ flex: "0 0 auto" }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
