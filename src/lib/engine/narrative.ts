/**
 * Deterministic, rule-based narrative — a plain-English summary of the
 * forecast without an LLM. This is the trustworthy baseline; the app can layer
 * a richer LLM narrative on top, but this always renders, is unit-testable, and
 * never hallucinates a number.
 */

import type { ForecastResult } from "./types.js";

export function narrate(result: ForecastResult): string {
  const lines: string[] = [];
  const money = fmt;

  lines.push(
    `Starting cash is ${money(result.startingCash)} across ${result.bankAccounts.length} account(s).`,
  );

  const first = result.periods[0];
  const last = result.periods[result.periods.length - 1];
  if (first && last) {
    const change = last.endingBalance - result.startingCash;
    const dir = change >= 0 ? "grows to" : "falls to";
    lines.push(
      `Over the ${result.periods.length}-period horizon, cash ${dir} ${money(last.endingBalance)} ` +
        `(${change >= 0 ? "+" : ""}${money(change)}).`,
    );
  }

  lines.push(
    `Average monthly burn is ${money(result.monthlyBurn)}; the ${result.settings.reserveMultiple}× ` +
      `reserve target is ${money(result.reserveTarget)} (${result.reserveExcess >= 0 ? "excess" : "shortfall"} ` +
      `of ${money(Math.abs(result.reserveExcess))} at horizon end).`,
  );

  if (result.runwayMonths === null) {
    lines.push("Cash stays positive throughout the forecast horizon.");
  } else {
    lines.push(`At the current trajectory, cash runs out in ~${result.runwayMonths.toFixed(1)} months.`);
  }

  // Highlight the largest single-period swings to explain "why cash moves".
  const biggestDrop = [...result.periods].sort((a, b) => a.netFlow - b.netFlow)[0];
  if (biggestDrop && biggestDrop.netFlow < 0) {
    lines.push(
      `The largest single-period outflow is ${money(biggestDrop.netFlow)} in ${biggestDrop.period.label}, ` +
        `driven mainly by ${topDisbursement(biggestDrop)}.`,
    );
  }

  if (result.alerts.length > 0) {
    lines.push("");
    lines.push("Alerts:");
    for (const a of result.alerts) {
      lines.push(`  • [${a.severity}] ${a.message}`);
    }
  }

  return lines.join("\n");
}

function topDisbursement(pf: ForecastResult["periods"][number]): string {
  const entries = Object.entries(pf.disbursements) as Array<[string, number]>;
  const top = entries.sort((a, b) => b[1] - a[1])[0];
  return top ? `${humanCategory(top[0])} (${fmt(top[1])})` : "operating costs";
}

const LABELS: Record<string, string> = {
  payroll: "payroll",
  operatingExpense: "operating expense",
  amex: "American Express",
  otherWithdrawals: "other withdrawals",
  accountsPayable: "accounts payable",
  apEstimate: "AP estimate",
  bonusAccruals: "bonus accruals",
};

function humanCategory(key: string): string {
  return LABELS[key] ?? key;
}

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}
