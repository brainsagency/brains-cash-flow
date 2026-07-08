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

/** Today as an ISO date (YYYY-MM-DD), local time. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days between an ISO date and today (>= 0 for past dates). */
export function daysAgo(iso: string): number {
  const then = new Date(`${iso}T00:00:00`).getTime();
  const now = new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round((now - then) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-24" -> "24 Nov '26". */
export function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} '${String(y).slice(2)}`;
}

/** Axis label for a period start date, by granularity. */
export function fmtAxisLabel(iso: string, view: "week" | "month"): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return view === "week" ? `${m}/${d}` : `${MONTHS[m - 1]} '${String(y).slice(2)}`;
}

/** Days -> "60 days" / "8 months" depending on scale. */
export function fmtDuration(days: number, prefer: "days" | "months"): string {
  if (days <= 0) return "now";
  if (prefer === "days" && days < 90) return `${days} days`;
  const months = days / (365.25 / 12);
  return months < 1.5 ? `${Math.round(days / 7)} weeks` : `${Math.round(months)} months`;
}
