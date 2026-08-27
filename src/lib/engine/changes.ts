/**
 * "What's changed" — a deterministic diff between two points in time.
 *
 * Two `ForecastInput`s (a stored snapshot and the live workspace) are reduced
 * to comparable cash lines and paired up, so the UI can say *why* the outlook
 * moved: a bill appeared, an invoice slipped, a salary changed, the bank
 * balance was re-synced. Like `narrate`, this is rule-based and unit-testable —
 * every figure traces back to a line, nothing is inferred.
 *
 * The one subtlety is measuring both sides on the same ground. A snapshot taken
 * last week carries an older anchor, so it would otherwise be scored over a
 * different horizon and every stream would look "changed" by a week of cash.
 * `rebaseTo` moves the old input onto the current anchor and horizon before
 * anything is compared; cash that has since happened simply falls out of both
 * windows, which is the honest reading.
 */

import { buildPeriods } from "./periods.js";
import { collectEvents, forecast, weightedAmount } from "./forecast.js";
import { daysBetween, type ISODate } from "./dates.js";
import { humanCategory } from "./narrative.js";
import {
  DEFAULT_HORIZON,
  directionOf,
  type BankAccount,
  type CashCategory,
  type CashEvent,
  type Direction,
  type ForecastInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface ChangeWindow {
  /** Inclusive first date scored (the current anchor). */
  start: ISODate;
  /** Inclusive last date scored (the current horizon end). */
  end: ISODate;
}

export type ChangeKind =
  | "added" // a stream that wasn't there before
  | "removed" // a stream that's gone
  | "increased" // same stream, more cash moving
  | "decreased" // same stream, less cash moving
  | "moved" // same cash, different date
  | "balance"; // a bank balance was updated

/** One bullet: a single thing that changed, and what it did to cash. */
export interface CashChange {
  /** Stable identity of the line across snapshots. */
  key: string;
  label: string;
  kind: ChangeKind;
  /**
   * Signed effect on projected cash over the window: positive improves cash
   * (more receipts / less spending), negative hurts it. Pure timing moves are
   * 0 — the cash still lands, just later or sooner.
   */
  cashImpact: number;
  /** Absent for bank-balance changes, which aren't a cash stream. */
  category?: CashCategory;
  direction?: Direction;
  /** Window totals (positive magnitudes), before and after. */
  before: number;
  after: number;
  /** First occurrence in the window, before and after. */
  beforeDate?: ISODate;
  afterDate?: ISODate;
  /** Days the first occurrence moved (positive = later). */
  dayShift?: number;
  /** Occurrences in the window — tells a one-off from a recurring stream. */
  beforeCount?: number;
  afterCount?: number;
}

export interface MetricChange {
  key: "startingCash" | "endingCash" | "runwayMonths" | "monthlyBurn";
  label: string;
  before: number | null;
  after: number | null;
  /** after − before, or null when either side is null (open-ended runway). */
  delta: number | null;
}

export interface ChangeReport {
  window: ChangeWindow;
  /** Material changes, biggest cash impact first; timing moves last. */
  changes: CashChange[];
  /** Sum of every material change's cash impact. */
  netImpact: number;
  /** Positive impacts only (things that helped cash). */
  positiveImpact: number;
  /** Negative impacts only (things that hurt cash), as a negative number. */
  negativeImpact: number;
  /** Changes that fell below the materiality threshold. */
  omittedCount: number;
  /** Net cash impact of everything omitted, so the total still reconciles. */
  omittedImpact: number;
  metrics: MetricChange[];
}

export interface ChangeOptions {
  /** Ignore a line whose cash impact is smaller than this. Default 2,500. */
  minImpact?: number;
  /** A pure timing move must shift at least this many days. Default 5. */
  minDayShift?: number;
  /** ...and involve at least this much cash to be worth a bullet. Default 10,000. */
  minMoveAmount?: number;
  /** Ignore a bank balance change smaller than this. Default 5,000. */
  minBalanceChange?: number;
  /** Cap on returned bullets (0 = no cap). Default 14. */
  limit?: number;
}

const DEFAULTS = {
  minImpact: 2_500,
  minDayShift: 5,
  minMoveAmount: 10_000,
  minBalanceChange: 5_000,
  limit: 14,
} satisfies Required<ChangeOptions>;

// ---------------------------------------------------------------------------
// Digest: a forecast input reduced to comparable lines
// ---------------------------------------------------------------------------

interface DigestLine {
  key: string;
  label: string;
  category: CashCategory;
  direction: Direction;
  /** Probability-weighted cash in the window (positive magnitude). */
  total: number;
  count: number;
  firstDate: ISODate;
}

/**
 * Identity of a cash line across snapshots.
 *
 * A source id (invoice, bill, roster member, recurring item) is authoritative
 * and every expanded occurrence of a recurring item carries it, so a stream
 * collapses to one line. Hand-entered events fall back to category + memo,
 * which keeps "Q3 bonus" recognizable as the same line after its date or
 * amount is edited — the whole point of the diff. Only a nameless event has to
 * fall back to its date, where a re-date reads as remove + add.
 */
function lineKey(e: CashEvent): string {
  if (e.id) return `id:${e.id}`;
  const memo = (e.memo ?? "").trim().toLowerCase();
  return memo ? `memo:${e.category}|${memo}` : `at:${e.category}|${e.date}`;
}

/** Reduce an input to its cash lines within `window`. */
export function digest(input: ForecastInput, window: ChangeWindow): Map<string, DigestLine> {
  const lines = new Map<string, DigestLine>();
  for (const e of collectEvents(input, window.end)) {
    if (e.date < window.start || e.date > window.end) continue;
    const amount = weightedAmount(e);
    if (amount === 0) continue;
    const key = lineKey(e);
    const existing = lines.get(key);
    if (existing) {
      existing.total += amount;
      existing.count += 1;
      if (e.date < existing.firstDate) existing.firstDate = e.date;
      continue;
    }
    lines.set(key, {
      key,
      label: (e.memo ?? "").trim() || capitalize(humanCategory(e.category)),
      category: e.category,
      direction: directionOf(e.category),
      total: amount,
      count: 1,
      firstDate: e.date,
    });
  }
  return lines;
}

/**
 * Move an older input onto the current anchor and horizon so both sides of a
 * diff are scored over the same window. Everything else — balances, streams,
 * settings — is left exactly as it was, since a change to any of those is a
 * real change we want to surface.
 */
export function rebaseTo(older: ForecastInput, current: ForecastInput): ForecastInput {
  return {
    ...older,
    anchorDate: current.anchorDate,
    ...(current.horizon !== undefined ? { horizon: current.horizon } : {}),
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Compare a stored snapshot against the live workspace.
 *
 * `before` is rebased onto `after`'s anchor and horizon internally — pass the
 * snapshot exactly as it was captured.
 */
export function diffForecasts(
  before: ForecastInput,
  after: ForecastInput,
  options: ChangeOptions = {},
): ChangeReport {
  const opts = { ...DEFAULTS, ...options };
  const horizon = after.horizon ?? DEFAULT_HORIZON;
  const periods = buildPeriods(after.anchorDate, horizon);
  const window: ChangeWindow = {
    start: after.anchorDate,
    end: periods[periods.length - 1]?.end ?? after.anchorDate,
  };

  const prev = rebaseTo(before, after);
  const prevLines = digest(prev, window);
  const nextLines = digest(after, window);

  const all: CashChange[] = [];
  for (const key of new Set([...prevLines.keys(), ...nextLines.keys()])) {
    const change = compareLine(prevLines.get(key), nextLines.get(key), opts);
    if (change) all.push(change);
  }
  all.push(...compareAccounts(prev.bankAccounts ?? [], after.bankAccounts ?? []));

  // Split on materiality, then rank: real cash impact first (biggest first),
  // pure timing moves after, since they change *when* not *whether*.
  const material: CashChange[] = [];
  let omittedCount = 0;
  let omittedImpact = 0;
  for (const c of all) {
    if (isMaterial(c, opts)) material.push(c);
    else {
      omittedCount += 1;
      omittedImpact += c.cashImpact;
    }
  }
  material.sort((a, b) => {
    const aMove = a.kind === "moved" ? 1 : 0;
    const bMove = b.kind === "moved" ? 1 : 0;
    if (aMove !== bMove) return aMove - bMove;
    if (aMove === 1) return Math.max(b.before, b.after) - Math.max(a.before, a.after);
    return Math.abs(b.cashImpact) - Math.abs(a.cashImpact);
  });

  const kept = opts.limit > 0 ? material.slice(0, opts.limit) : material;
  for (const c of material.slice(kept.length)) {
    omittedCount += 1;
    omittedImpact += c.cashImpact;
  }

  const netImpact = kept.reduce((s, c) => s + c.cashImpact, 0);
  return {
    window,
    changes: kept,
    netImpact,
    positiveImpact: kept.reduce((s, c) => s + Math.max(0, c.cashImpact), 0),
    negativeImpact: kept.reduce((s, c) => s + Math.min(0, c.cashImpact), 0),
    omittedCount,
    omittedImpact,
    metrics: compareMetrics(prev, after),
  };
}

function compareLine(
  before: DigestLine | undefined,
  after: DigestLine | undefined,
  opts: Required<ChangeOptions>,
): CashChange | null {
  const line = after ?? before;
  if (!line) return null;
  const beforeTotal = before?.total ?? 0;
  const afterTotal = after?.total ?? 0;
  // More receipts help cash; more disbursements hurt it.
  const sign = line.direction === "in" ? 1 : -1;
  const cashImpact = sign * (afterTotal - beforeTotal);

  const base = {
    key: line.key,
    label: line.label,
    category: line.category,
    direction: line.direction,
    before: beforeTotal,
    after: afterTotal,
    beforeDate: before?.firstDate,
    afterDate: after?.firstDate,
    beforeCount: before?.count,
    afterCount: after?.count,
  };

  if (!before) return { ...base, kind: "added", cashImpact };
  if (!after) return { ...base, kind: "removed", cashImpact };

  const dayShift = daysBetween(before.firstDate, after.firstDate);
  // Sub-dollar drift is rounding, not a change worth a bullet.
  if (Math.abs(afterTotal - beforeTotal) < 1) {
    return dayShift !== 0 ? { ...base, kind: "moved", cashImpact: 0, dayShift } : null;
  }
  return {
    ...base,
    kind: afterTotal > beforeTotal ? "increased" : "decreased",
    cashImpact,
    ...(dayShift !== 0 ? { dayShift } : {}),
  };
}

/**
 * Bank balances, matched by account id. A re-synced or re-keyed balance moves
 * starting cash dollar-for-dollar, so it belongs in the same list as the
 * streams — it's usually the single biggest thing that changed.
 */
function compareAccounts(before: BankAccount[], after: BankAccount[]): CashChange[] {
  const prev = new Map(before.map((a) => [a.id, a]));
  const out: CashChange[] = [];
  for (const acct of after) {
    const was = prev.get(acct.id);
    if (!was || was.beginningBalance === acct.beginningBalance) continue;
    // A non-operating account (HYSA, shareholder) isn't rolled forward by the
    // forecast, so its balance moving doesn't change projected cash.
    const counts = acct.operating !== false;
    out.push({
      key: `account:${acct.id}`,
      label: `${acct.name}${acct.mask ? ` ····${acct.mask}` : ""} balance`,
      kind: "balance",
      cashImpact: counts ? acct.beginningBalance - was.beginningBalance : 0,
      before: was.beginningBalance,
      after: acct.beginningBalance,
      beforeDate: was.balanceAsOf,
      afterDate: acct.balanceAsOf,
    });
  }
  return out;
}

function isMaterial(c: CashChange, opts: Required<ChangeOptions>): boolean {
  if (c.kind === "moved") {
    return (
      Math.abs(c.dayShift ?? 0) >= opts.minDayShift &&
      Math.max(c.before, c.after) >= opts.minMoveAmount
    );
  }
  if (c.kind === "balance") {
    // Judge a balance move on the size of the move itself, so a non-operating
    // account's update still surfaces (as a $0-impact note) when it's large.
    return Math.abs(c.after - c.before) >= opts.minBalanceChange;
  }
  return Math.abs(c.cashImpact) >= opts.minImpact;
}

function compareMetrics(before: ForecastInput, after: ForecastInput): MetricChange[] {
  const a = forecast(before);
  const b = forecast(after);
  const endA = a.periods[a.periods.length - 1]?.endingBalance ?? a.startingCash;
  const endB = b.periods[b.periods.length - 1]?.endingBalance ?? b.startingCash;
  return [
    metric("startingCash", "Cash on hand", a.startingCash, b.startingCash),
    metric("endingCash", "Projected cash at horizon", endA, endB),
    metric("runwayMonths", "Runway", a.runwayMonths, b.runwayMonths),
    metric("monthlyBurn", "Monthly burn", a.monthlyBurn, b.monthlyBurn),
  ];
}

function metric(
  key: MetricChange["key"],
  label: string,
  before: number | null,
  after: number | null,
): MetricChange {
  return {
    key,
    label,
    before,
    after,
    delta: before === null || after === null ? null : after - before,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Narrative: the story, with the numbers as support
// ---------------------------------------------------------------------------

/**
 * What a category is *called* when a whole stream moves — "Payroll increased",
 * "Card spend decreased". Plural/mass nouns, because a stream is many payments.
 */
const STREAM_NOUN: Record<CashCategory, string> = {
  currentAR: "Client payments",
  overdueAR: "Overdue collections",
  notInvoiced: "Not-yet-invoiced work",
  pipeline: "Pipeline revenue",
  locDraw: "Credit line draws",
  payroll: "Payroll",
  operatingExpense: "Operating costs",
  amex: "Card spend",
  freelance: "Freelance spend",
  otherWithdrawals: "Owner withdrawals",
  accountsPayable: "Bills",
  apEstimate: "AP estimate",
  bonusAccruals: "Bonus accruals",
  taxes: "Estimated taxes",
};

/**
 * What a category is called when a single line appears or disappears — "New
 * bill", "New one-time expense". Singular, and count-aware where a one-off and
 * a recurring commitment are genuinely different news.
 */
function addedNoun(category: CashCategory, count: number): string {
  const recurring = count > 1;
  switch (category) {
    case "currentAR":
      return recurring ? "recurring receipt" : "invoice";
    case "overdueAR":
      return "overdue invoice";
    case "notInvoiced":
      return "not-yet-invoiced receipt";
    case "pipeline":
      return "pipeline deal";
    case "locDraw":
      return "credit line draw";
    case "payroll":
      return recurring ? "payroll commitment" : "payroll cost";
    case "operatingExpense":
      return recurring ? "recurring cost" : "one-time expense";
    case "amex":
      return recurring ? "card budget" : "card charge";
    case "freelance":
      return recurring ? "freelance budget" : "freelance cost";
    case "otherWithdrawals":
      return "withdrawal";
    case "accountsPayable":
      return "bill";
    case "apEstimate":
      return "AP estimate";
    case "bonusAccruals":
      return "bonus payout";
    case "taxes":
      return "tax payment";
  }
}

/**
 * The headline for one bullet — the story, not the figures: "New one-time
 * expense", "Payroll increased", "Payment slipped later". The line's name and
 * amounts are the supporting detail underneath it.
 */
export function changeHeadline(c: CashChange): string {
  if (c.kind === "balance") return "Bank balance updated";
  const category = c.category;
  if (!category) return "Changed";
  const later = (c.dayShift ?? 0) > 0;

  switch (c.kind) {
    case "added":
      return `New ${addedNoun(category, c.afterCount ?? 1)}`;
    case "removed":
      return `${capitalize(addedNoun(category, c.beforeCount ?? 1))} ${
        c.direction === "in" ? "dropped" : "removed"
      }`;
    case "increased":
      return `${STREAM_NOUN[category]} increased`;
    case "decreased":
      return `${STREAM_NOUN[category]} decreased`;
    case "moved":
      if (c.direction === "in") return later ? "Payment slipped later" : "Payment pulled forward";
      return later ? "Payment pushed out" : "Payment moved earlier";
  }
}


/**
 * The story groups by category, the bullets don't.
 *
 * Three separate payroll edits are three bullets — you want to see each one —
 * but in a sentence they'd read "payroll is up, payroll is down, payroll is
 * up". As one clause ("payroll is up $56.6k net across 3 changes") it's the
 * story a person would actually tell.
 */
interface DriverGroup {
  /** The lone change, when the group has exactly one — worth naming precisely. */
  only?: CashChange;
  category?: CashCategory;
  direction?: Direction;
  count: number;
  impact: number;
}

function groupDrivers(changes: CashChange[]): DriverGroup[] {
  const groups = new Map<string, DriverGroup>();
  for (const c of changes) {
    if (c.cashImpact === 0) continue;
    const key = c.kind === "balance" ? "balance" : `cat:${c.category}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.impact += c.cashImpact;
      delete existing.only;
      continue;
    }
    groups.set(key, {
      only: c,
      ...(c.category !== undefined ? { category: c.category } : {}),
      ...(c.direction !== undefined ? { direction: c.direction } : {}),
      count: 1,
      impact: c.cashImpact,
    });
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

function groupFragment(g: DriverGroup): string {
  if (g.only) return fragment(g.only);
  const magnitude = short(Math.abs(g.impact));
  if (!g.category) {
    return `bank balances came in ${magnitude} ${g.impact > 0 ? "higher" : "lower"} across ${g.count} accounts`;
  }
  // "Up" means more money moving through the line, whichever way it flows —
  // more receipts help cash, more spending hurts it.
  const flowUp = g.direction === "in" ? g.impact > 0 : g.impact < 0;
  return `${STREAM_NOUN[g.category].toLowerCase()} is ${flowUp ? "up" : "down"} ${magnitude} net across ${g.count} changes`;
}

/** A clause for the story sentence: "card spend is up $135k". */
function fragment(c: CashChange): string {
  const delta = Math.abs(c.after - c.before);
  if (c.kind === "balance") {
    const higher = c.after > c.before;
    return `the ${c.label.replace(/ balance$/, "")} balance came in ${short(delta)} ${higher ? "higher" : "lower"}`;
  }
  const category = c.category;
  if (!category) return c.label;
  const noun = STREAM_NOUN[category].toLowerCase();

  switch (c.kind) {
    case "added":
      // Carries its own verb so it reads alongside "x is up y" in one sentence.
      return `a new ${short(c.after)} ${addedNoun(category, c.afterCount ?? 1)} landed`;
    case "removed":
      return `${short(c.before)} of ${noun} came off the forecast`;
    case "increased":
      return `${noun} is up ${short(delta)}`;
    case "decreased":
      return `${noun} is down ${short(delta)}`;
    case "moved":
      return `${short(c.after)} of ${noun} moved`;
  }
}

/** Join clauses the way a person would: "a, b and c". */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface NarrateChangesOptions {
  /** How to refer to the baseline in prose, e.g. "a week ago". */
  since?: string;
  /** How many drivers to name in the story sentence. Default 3. */
  drivers?: number;
  /** Below this, the net move is called "essentially unchanged". Default 1,000. */
  flatBelow?: number;
}

/**
 * The story in two or three sentences: which way cash moved, what drove it,
 * and what it did to runway. Rule-based like `narrate` — every figure comes
 * from a line in the report, nothing is inferred.
 */
export function narrateChanges(report: ChangeReport, options: NarrateChangesOptions = {}): string {
  const since = options.since ?? "the last snapshot";
  const driverCount = options.drivers ?? 3;
  const flatBelow = options.flatBelow ?? 1_000;
  const sentences: string[] = [];

  const net = report.netImpact;
  sentences.push(
    Math.abs(net) < flatBelow
      ? `Cash is essentially unchanged since ${since}.`
      : `Cash is ${short(Math.abs(net))} ${net > 0 ? "better" : "worse"} off than ${since}.`,
  );

  const drivers = groupDrivers(report.changes).slice(0, driverCount);
  if (drivers.length > 0) {
    const lead = drivers.length === 1 ? "The mover" : "The movers";
    sentences.push(`${lead}: ${joinClauses(drivers.map(groupFragment))}.`);
  }

  const runway = report.metrics.find((m) => m.key === "runwayMonths");
  if (runway) {
    if (runway.before !== null && runway.after === null) {
      sentences.push("Cash now stays positive across the whole horizon.");
    } else if (runway.before === null && runway.after !== null) {
      sentences.push(`Cash now runs out inside the horizon, at ${runway.after.toFixed(1)} months.`);
    } else if (runway.delta !== null && Math.abs(runway.delta) >= 0.1 && runway.after !== null) {
      const dir = runway.delta < 0 ? "shortened" : "extended";
      sentences.push(
        `Runway ${dir} by ${Math.abs(runway.delta).toFixed(1)} months, to ${runway.after.toFixed(1)}.`,
      );
    }
  }

  const moves = report.changes.filter((c) => c.kind === "moved");
  if (moves.length > 0) {
    const total = moves.reduce((s, c) => s + c.after, 0);
    const later = moves.filter((c) => (c.dayShift ?? 0) > 0).length >= moves.length / 2;
    const when = later ? "later" : "earlier";
    const first = moves[0]!;
    sentences.push(
      moves.length === 1
        ? `Separately, a ${short(total)} payment shifted ${Math.abs(first.dayShift ?? 0)} days ${when} ` +
          "without changing the total."
        : `Separately, ${short(total)} across ${moves.length} payments shifted ${when} ` +
          "without changing the total.",
    );
  }

  return sentences.join(" ");
}

/** Compact money for prose: $1.3M, $286k, $950. */
function short(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trim(abs / 1_000)}k`;
  return `$${Math.round(abs)}`;
}

function trim(x: number): string {
  return x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.0+$/, "");
}
