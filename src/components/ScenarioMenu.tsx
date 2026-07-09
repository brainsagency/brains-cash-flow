"use client";

import { useState } from "react";
import type { Scenario } from "@engine/index.js";

/**
 * Float-style scenario picker for the Overview: Base is always shown; each
 * scenario is a toggle that overlays its line on the chart. "Create scenario"
 * opens the builder.
 */
export function ScenarioMenu({
  scenarios,
  selectedIds,
  colorFor,
  onToggle,
  onCreate,
}: {
  scenarios: Scenario[];
  selectedIds: string[];
  colorFor: (id: string) => string;
  onToggle: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nOn = selectedIds.length;

  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm ghost" onClick={() => setOpen((v) => !v)}>
        Scenarios{nOn > 0 ? ` · ${nOn} on` : ""} <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover" style={{ right: 0, left: "auto", width: 280 }}>
            <div className="pop-head">Compare on chart</div>
            <div className="pop-row" style={{ cursor: "default" }}>
              <span style={{ width: 12, height: 3, background: "#2e7354", borderRadius: 2, display: "inline-block" }} />
              <span className="pop-name">Base (always shown)</span>
            </div>
            {scenarios.length === 0 && (
              <div className="muted" style={{ padding: "6px 4px", fontSize: 12 }}>No scenarios yet.</div>
            )}
            {scenarios.map((s) => {
              const on = selectedIds.includes(s.id);
              return (
                <label key={s.id} className="pop-row">
                  <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} />
                  <span
                    style={{ width: 12, height: 3, borderRadius: 2, display: "inline-block", background: on ? colorFor(s.id) : "var(--border-strong)" }}
                  />
                  <span className="pop-name">{s.name}</span>
                </label>
              );
            })}
            <button
              className="btn sm primary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => { setOpen(false); onCreate(); }}
            >
              + Create scenario
            </button>
          </div>
        </>
      )}
    </div>
  );
}
