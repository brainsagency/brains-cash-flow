import { describe, expect, it } from "vitest";
import type { CashEvent } from "@engine/index.js";
import { reconcileAp } from "./reconcile.js";

const ap = (amount: number): CashEvent => ({ category: "accountsPayable", amount, date: "2026-07-06" });

describe("reconcileAp", () => {
  it("reports in-sync when totals match within tolerance", () => {
    const r = reconcileAp([ap(100), ap(200)], [ap(300)]);
    expect(r.billTotal).toBe(300);
    expect(r.qboTotal).toBe(300);
    expect(r.delta).toBe(0);
    expect(r.inSync).toBe(true);
  });

  it("flags a delta when the systems disagree", () => {
    const r = reconcileAp([ap(100), ap(250)], [ap(300)]);
    expect(r.delta).toBe(50);
    expect(r.inSync).toBe(false);
    expect(r.billCount).toBe(2);
    expect(r.qboCount).toBe(1);
  });
});
