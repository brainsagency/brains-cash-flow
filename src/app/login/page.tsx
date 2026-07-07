"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError(true);
        setBusy(false);
      }
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 8 }}>
          <span className="logo">B</span> Brains Cash Flow
        </div>
        <p className="muted" style={{ margin: "0 0 16px" }}>Enter the password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          aria-label="Password"
        />
        {error && (
          <div className="alert critical" style={{ marginTop: 10 }}>
            <span className="ico">🔴</span>
            <span>Incorrect password.</span>
          </div>
        )}
        <button className="btn primary" style={{ marginTop: 14, width: "100%" }} disabled={busy}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
