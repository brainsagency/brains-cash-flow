/**
 * Reconcile Bill.com AP (source of truth) against QuickBooks Bills (validation).
 * Surfaces whether the two systems agree on open payables — a trust check
 * during the parallel-run period.
 */

import type { CashEvent } from "@engine/index.js";

export interface ApReconciliation {
  billCount: number;
  billTotal: number;
  qboCount: number;
  qboTotal: number;
  /** billTotal − qboTotal (rounded). */
  delta: number;
  /** True when the totals agree within `tolerance`. */
  inSync: boolean;
}

function sum(events: CashEvent[]): number {
  return events.reduce((s, e) => s + e.amount, 0);
}

export function reconcileAp(
  billEvents: CashEvent[],
  qboEvents: CashEvent[],
  tolerance = 1,
): ApReconciliation {
  const billTotal = sum(billEvents);
  const qboTotal = sum(qboEvents);
  const delta = Math.round((billTotal - qboTotal) * 100) / 100;
  return {
    billCount: billEvents.length,
    billTotal,
    qboCount: qboEvents.length,
    qboTotal,
    delta,
    inSync: Math.abs(delta) <= tolerance,
  };
}
