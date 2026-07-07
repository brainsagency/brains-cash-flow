"use client";

import type { Alert } from "@engine/index.js";

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="card">
      <h2>Alerts</h2>
      {alerts.length === 0 ? (
        <div className="muted">No alerts — cash stays above $0 and the reserve target across the horizon.</div>
      ) : (
        alerts.map((a, i) => (
          <div key={i} className={`alert ${a.severity}`}>
            <span className="ico">{a.severity === "critical" ? "🔴" : "🟡"}</span>
            <span>{a.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
