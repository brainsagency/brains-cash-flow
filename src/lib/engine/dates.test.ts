import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addWeeks,
  daysBetween,
  isValidISODate,
  monthsBetween,
  startOfMonth,
  startOfWeek,
} from "./dates.js";

describe("dates", () => {
  it("validates ISO dates and rejects impossible ones", () => {
    expect(isValidISODate("2026-07-06")).toBe(true);
    expect(isValidISODate("2026-02-29")).toBe(false); // 2026 not a leap year
    expect(isValidISODate("2024-02-29")).toBe(true); // leap year
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-7-6")).toBe(false);
  });

  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds weeks", () => {
    expect(addWeeks("2026-07-06", 2)).toBe("2026-07-20");
  });

  it("clamps day-of-month when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("computes whole days between dates", () => {
    expect(daysBetween("2026-07-06", "2026-07-13")).toBe(7);
    expect(daysBetween("2026-07-13", "2026-07-06")).toBe(-7);
  });

  it("finds Monday start of week", () => {
    // 2026-07-06 is a Monday.
    expect(startOfWeek("2026-07-06")).toBe("2026-07-06");
    expect(startOfWeek("2026-07-08")).toBe("2026-07-06"); // Wed → Mon
    expect(startOfWeek("2026-07-05")).toBe("2026-06-29"); // Sun → prior Mon
  });

  it("finds first of month", () => {
    expect(startOfMonth("2026-07-06")).toBe("2026-07-01");
  });

  it("computes fractional months", () => {
    expect(monthsBetween("2026-01-01", "2026-02-01")).toBeCloseTo(1.0186, 2);
  });
});
