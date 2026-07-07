import { describe, expect, it } from "vitest";
import { buildPeriods, periodIndexForDate } from "./periods.js";

describe("buildPeriods", () => {
  const anchor = "2026-07-06"; // a Monday

  it("produces weeklyPeriods weekly + monthlyPeriods monthly, contiguous", () => {
    const periods = buildPeriods(anchor, { weeklyPeriods: 13, monthlyPeriods: 12 });
    expect(periods).toHaveLength(25);

    const weeks = periods.filter((p) => p.granularity === "week");
    const months = periods.filter((p) => p.granularity === "month");
    expect(weeks).toHaveLength(13);
    expect(months).toHaveLength(12);

    // Weekly window starts on the anchor Monday and is Mon–Sun.
    expect(weeks[0]!.start).toBe("2026-07-06");
    expect(weeks[0]!.end).toBe("2026-07-12");

    // No gaps: each period starts the day after the previous ends.
    for (let i = 1; i < periods.length; i++) {
      const prevEnd = periods[i - 1]!.end;
      const start = periods[i]!.start;
      const d = new Date(start).getTime() - new Date(prevEnd).getTime();
      expect(d).toBe(86_400_000);
    }
  });

  it("first monthly period absorbs the partial month after the weekly window", () => {
    const periods = buildPeriods(anchor, { weeklyPeriods: 13, monthlyPeriods: 12 });
    const lastWeek = periods.filter((p) => p.granularity === "week").at(-1)!;
    const firstMonth = periods.find((p) => p.granularity === "month")!;
    // 13 weeks from 2026-07-06 ends 2026-10-04 (Sun); month period starts next day.
    expect(lastWeek.end).toBe("2026-10-04");
    expect(firstMonth.start).toBe("2026-10-05");
    expect(firstMonth.end).toBe("2026-10-31");
    expect(firstMonth.label).toBe("2026-10");
  });

  it("assigns dates to the right period", () => {
    const periods = buildPeriods(anchor, { weeklyPeriods: 13, monthlyPeriods: 12 });
    expect(periodIndexForDate(periods, "2026-07-06")).toBe(0);
    expect(periodIndexForDate(periods, "2026-07-12")).toBe(0);
    expect(periodIndexForDate(periods, "2026-07-13")).toBe(1);
    expect(periodIndexForDate(periods, "2026-10-20")).toBe(13); // first monthly period
    expect(periodIndexForDate(periods, "2020-01-01")).toBe(-1); // before horizon
    expect(periodIndexForDate(periods, "2099-01-01")).toBe(-1); // after horizon
  });
});
