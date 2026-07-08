/**
 * Normalization: turn recurring items and pipeline deals into concrete,
 * dated `CashEvent`s so the projection only ever deals with one flat list.
 */

import { addDays, addMonths, addWeeks, isOnOrBefore, isValidISODate, type ISODate } from "./dates.js";
import type { CashEvent, PipelineDeal, RecurringItem } from "./types.js";

/**
 * Expand a recurring item into individual dated events between the item's
 * start and the earlier of its end date and `horizonEnd`.
 *
 * - weekly: every 7 days
 * - biweekly: every 14 days
 * - semimonthly: the 1st and 15th of each month (payroll convention)
 * - monthly: same day-of-month each month (clamped for short months)
 */
export function expandRecurring(item: RecurringItem, horizonEnd: ISODate): CashEvent[] {
  const last = item.endDate && item.endDate < horizonEnd ? item.endDate : horizonEnd;
  const events: CashEvent[] = [];

  if (item.frequency === "semimonthly") {
    // Emit the 1st and 15th within [start, last].
    let monthCursor = firstOfMonth(item.startDate);
    // Walk months until we pass `last`.
    while (isOnOrBefore(monthCursor, last)) {
      for (const day of [1, 15]) {
        const date = setDayOfMonth(monthCursor, day);
        if (isOnOrBefore(item.startDate, date) && isOnOrBefore(date, last)) {
          events.push(makeEvent(item, date));
        }
      }
      monthCursor = addMonths(monthCursor, 1);
    }
    return events;
  }

  let date: ISODate = item.startDate;
  let guard = 0;
  while (isOnOrBefore(date, last)) {
    events.push(makeEvent(item, date));
    date = advance(date, item.frequency);
    if (++guard > 10_000) break; // safety valve against a bad frequency/date
  }
  return events;
}

function advance(date: ISODate, freq: RecurringItem["frequency"]): ISODate {
  switch (freq) {
    case "weekly":
      return addWeeks(date, 1);
    case "biweekly":
      return addWeeks(date, 2);
    case "monthly":
      return addMonths(date, 1);
    case "semimonthly":
      return addWeeks(date, 2); // unreachable; handled above
  }
}

function makeEvent(item: RecurringItem, date: ISODate): CashEvent {
  return {
    ...(item.id !== undefined ? { id: item.id } : {}),
    category: item.category,
    amount: item.amount,
    date,
    ...(item.memo !== undefined ? { memo: item.memo } : {}),
  };
}

function firstOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

function setDayOfMonth(firstOfMonthDate: ISODate, day: number): ISODate {
  // firstOfMonthDate is always the 1st; add (day-1) days, staying in-month
  // for day 1 and 15 which never overflow.
  return addDays(firstOfMonthDate, day - 1);
}

/**
 * Convert a pipeline deal into a single probability-weighted receipt landing
 * on `expectedCloseDate + collectionLagDays`. The probability is carried on
 * the event so callers can see gross vs. weighted value.
 */
export function pipelineToEvent(deal: PipelineDeal): CashEvent {
  return {
    id: deal.id,
    category: "pipeline",
    amount: deal.value ?? 0,
    date: addDays(deal.expectedCloseDate ?? "", deal.collectionLagDays ?? 0),
    probability: clampProbability(deal.probability ?? 1),
    memo: deal.name,
  };
}

/**
 * Expand a deal into its receipt events. A `billings` schedule produces one
 * receipt per installment (each on its own date); otherwise it falls back to
 * the single legacy receipt. Installments/deals with an incomplete date are
 * skipped so the caller never feeds malformed dates to the period math.
 */
export function pipelineToEvents(deal: PipelineDeal): CashEvent[] {
  if (deal.billings && deal.billings.length > 0) {
    return deal.billings
      .filter((b) => isValidISODate(b.date))
      .map((b, i) => ({
        id: `${deal.id}:b${i}`,
        category: "pipeline",
        amount: b.amount,
        date: b.date,
        memo: deal.name,
      }));
  }
  if (!deal.expectedCloseDate || !isValidISODate(deal.expectedCloseDate)) return [];
  return [pipelineToEvent(deal)];
}

function clampProbability(p: number): number {
  if (Number.isNaN(p)) return 0;
  return Math.max(0, Math.min(1, p));
}
