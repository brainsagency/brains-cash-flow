"use client";

import { useMemo } from "react";
import { narrate, type ForecastResult } from "@engine/index.js";

export function NarrativePanel({ result }: { result: ForecastResult }) {
  // Deterministic, rule-based narrative (no LLM) — always renders, never
  // hallucinates a number. An LLM summary can layer on top later.
  const text = useMemo(() => {
    const full = narrate(result);
    // Drop the trailing "Alerts:" block — alerts render in their own panel.
    const idx = full.indexOf("\nAlerts:");
    return idx >= 0 ? full.slice(0, idx).trim() : full;
  }, [result]);

  return (
    <div className="card">
      <h2>What's happening</h2>
      <div className="narrative">{text}</div>
    </div>
  );
}
