/**
 * Period generation for the rolling horizon.
 *
 * The forecast timeline is mixed-granularity, exactly like a real rolling cash
 * forecast (and Float): near-term weekly detail followed by monthly roll-ups.
 * Weekly periods start on the anchor's Monday; monthly periods pick up on the
 * first of the month after the weekly window ends, contiguous with no gap.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  startOfMonth,
  startOfWeek,
  type ISODate,
} from "./dates.js";
import type { HorizonConfig, Period } from "./types.js";

/**
 * Build the list of periods for a forecast.
 *
 * - `weeklyPeriods` weeks, each Mon–Sun, the first being the week containing
 *   `anchorDate`.
 * - `monthlyPeriods` calendar months, the first being the month that starts
 *   strictly after the last weekly period ends. A partial month between the
 *   end of the weekly window and the first full month is absorbed into that
 *   first monthly period (so its `start` is the day after the weekly window).
 */
export function buildPeriods(anchorDate: ISODate, horizon: HorizonConfig): Period[] {
  const periods: Period[] = [];
  let index = 0;

  // --- Weekly window ---
  let weekStart = startOfWeek(anchorDate);
  let lastWeeklyEnd: ISODate | null = null;
  for (let w = 0; w < horizon.weeklyPeriods; w++) {
    const start = weekStart;
    const end = addDays(start, 6);
    periods.push({
      index: index++,
      granularity: "week",
      start,
      end,
      label: `Wk of ${start}`,
    });
    lastWeeklyEnd = end;
    weekStart = addWeeks(weekStart, 1);
  }

  // --- Monthly window ---
  // First monthly period begins the day after the weekly window (or the
  // anchor's month start if there is no weekly window), and runs to month end.
  let cursor: ISODate =
    lastWeeklyEnd !== null ? addDays(lastWeeklyEnd, 1) : startOfMonth(anchorDate);

  for (let m = 0; m < horizon.monthlyPeriods; m++) {
    const start = cursor;
    // End of the calendar month that `start` falls in.
    const firstOfThisMonth = startOfMonth(start);
    const firstOfNextMonth = addMonths(firstOfThisMonth, 1);
    const end = addDays(firstOfNextMonth, -1);
    periods.push({
      index: index++,
      granularity: "month",
      start,
      end,
      label: monthLabel(firstOfThisMonth),
    });
    cursor = firstOfNextMonth;
  }

  return periods;
}

function monthLabel(firstOfMonth: ISODate): string {
  return firstOfMonth.slice(0, 7); // "YYYY-MM"
}

/**
 * Find the index of the period whose [start, end] range contains `date`.
 * Returns -1 if the date falls outside the whole horizon.
 */
export function periodIndexForDate(periods: Period[], date: ISODate): number {
  for (const p of periods) {
    if (date >= p.start && date <= p.end) return p.index;
  }
  return -1;
}
