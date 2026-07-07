/** Display formatting helpers shared across the UI. */

export function fmtMoney(n: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
  const plus = opts.sign && !neg ? "+" : "";
  return `${neg ? "-" : plus}$${body}`;
}

/** Compact money for axis labels / KPIs: $1.3M, $450k, -$12k. */
export function fmtMoneyShort(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `${trim(abs / 1_000_000)}M`;
  else if (abs >= 1_000) body = `${trim(abs / 1_000)}k`;
  else body = `${Math.round(abs)}`;
  return `${neg ? "-" : ""}$${body}`;
}

function trim(x: number): string {
  return x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.0+$/, "");
}

export function fmtMonths(n: number | null): string {
  if (n === null) return "∞";
  if (n < 1) return `${(n * 4.345).toFixed(1)} wk`;
  return `${n.toFixed(1)} mo`;
}

export function fmtDate(iso: string): string {
  return iso;
}
