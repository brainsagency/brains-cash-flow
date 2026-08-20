import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFIT_LABEL,
  ProfitRowNotFoundError,
  monthColumnsInRow,
  monthOfHeaderCell,
  parseMonthlyProfit,
  parseNumericCell,
  yearFromTabTitle,
} from "./map.js";

/**
 * A miniature of the real projections tab: a couple of client blocks (each with
 * its own Jan–Dec header) above the Summary block, with the label in column 2
 * and figures starting at column 8 — the shape read from the live sheet on
 * 2026-08-20.
 */
function projectionsGrid(): unknown[][] {
  const pad = (cells: unknown[]) => [null, null, ...cells];
  const monthHeader = (first: string) => [
    ...Array(8).fill(null),
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    "Total",
    first,
  ];
  const dataRow = (label: string, values: number[]) => [
    null,
    "Summary",
    label,
    null, null, null, null, null,
    ...values,
  ];

  return [
    pad(["x"]),
    monthHeader("Retainer"),
    [null, "Retainer", "Adoro Pet", null, null, null, null, null, ...Array(12).fill(13_200)],
    [null, "Retainer", "Retainer Total", null, null, null, null, null, ...Array(12).fill(121_400)],
    monthHeader("Projects"),
    [null, "Projects", "Projects Total", null, null, null, null, null, ...Array(12).fill(233_540)],
    dataRow("Projected Revenue", [
      405_972, 519_762, 601_808, 547_816, 494_700, 361_746,
      409_680, 509_736, 426_625, 359_375, 339_375, 216_875,
    ]),
    dataRow("Breakeven Expenses Budget / Actual", [
      -427_226, -489_964, -433_982, -472_200, -412_365, -409_167,
      -433_545, -458_189, -364_192, -372_828, -347_057, -347_057,
    ]),
    dataRow("Projected Operating Profit", [
      -21_564, 14_798, 151_826, 57_876, 82_336, -71_621,
      -36_365, 39_047, 28_168, -34_803, -21_332, -142_682,
    ]),
    dataRow("Cash Net Income", Array(12).fill(-65_022)),
  ];
}

describe("parseNumericCell", () => {
  it("passes real numbers through", () => {
    expect(parseNumericCell(-21_564)).toBe(-21_564);
    expect(parseNumericCell(0)).toBe(0);
  });

  it("strips currency formatting from text cells", () => {
    expect(parseNumericCell("-$21,564")).toBe(-21_564);
    expect(parseNumericCell("$151,826")).toBe(151_826);
    expect(parseNumericCell(" 1,234.50 ")).toBe(1_234.5);
  });

  it("reads accounting parentheses as negative", () => {
    expect(parseNumericCell("(21,564)")).toBe(-21_564);
    expect(parseNumericCell("$ (16,750)")).toBe(-16_750);
  });

  it("returns null for blanks and non-numbers", () => {
    for (const v of ["", "  ", "-", "—", "n/a", "#REF!", null, undefined, {}]) {
      expect(parseNumericCell(v)).toBeNull();
    }
  });
});

describe("monthOfHeaderCell", () => {
  it("recognizes month names and abbreviations", () => {
    expect(monthOfHeaderCell("Jan")).toBe(1);
    expect(monthOfHeaderCell("  september ")).toBe(9);
    expect(monthOfHeaderCell("Dec-26")).toBe(12);
  });

  it("recognizes date-formatted headers", () => {
    expect(monthOfHeaderCell("7/1/2026")).toBe(7);
    expect(monthOfHeaderCell("11/30/26")).toBe(11);
  });

  it("ignores everything else", () => {
    for (const v of ["Total", "Retainer", "", null, 42]) {
      expect(monthOfHeaderCell(v)).toBeNull();
    }
  });
});

describe("monthColumnsInRow", () => {
  it("maps each month to its column", () => {
    const row = [null, "Label", ...Array.from({ length: 12 }, (_, i) => `M${i}`)];
    expect(monthColumnsInRow(row)).toBeNull(); // not month names

    const header = [null, null, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(monthColumnsInRow(header)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("ignores a second year block repeated to the right", () => {
    const header = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      "Total", "Jan", "Feb", "Mar"];
    // The repeat is skipped because those months are already claimed.
    expect(monthColumnsInRow(header)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("rejects a row with too few months to be a header", () => {
    expect(monthColumnsInRow(["Jan", "notes", "Feb"])).toBeNull();
    expect(monthColumnsInRow([])).toBeNull();
  });
});

describe("parseMonthlyProfit", () => {
  it("reads the operating profit row from the real sheet shape", () => {
    const result = parseMonthlyProfit(projectionsGrid(), { year: 2026 });
    expect(result.matchedLabel).toBe("Projected Operating Profit");
    expect(result.missingMonths).toEqual([]);
    expect(result.monthlyProfit).toEqual({
      "2026-01": -21_564,
      "2026-02": 14_798,
      "2026-03": 151_826,
      "2026-04": 57_876,
      "2026-05": 82_336,
      "2026-06": -71_621,
      "2026-07": -36_365,
      "2026-08": 39_047,
      "2026-09": 28_168,
      "2026-10": -34_803,
      "2026-11": -21_332,
      "2026-12": -142_682,
    });
  });

  it("sums to the annual total the sheet shows", () => {
    const { monthlyProfit } = parseMonthlyProfit(projectionsGrid(), { year: 2026 });
    const total = Object.values(monthlyProfit).reduce((a, b) => a + b, 0);
    expect(total).toBe(45_684); // sheet displays $45,685 after per-month rounding
  });

  it("uses the nearest header above the label, not the first in the grid", () => {
    const result = parseMonthlyProfit(projectionsGrid(), { year: 2026 });
    expect(result.headerRowIndex).toBe(4); // the Projects block header
  });

  it("does not confuse the revenue row for the profit row", () => {
    const revenue = parseMonthlyProfit(projectionsGrid(), { year: 2026, label: "Projected Revenue" });
    expect(revenue.monthlyProfit["2026-01"]).toBe(405_972);
  });

  it("survives the Summary block moving when clients are added", () => {
    const grid = projectionsGrid();
    const extra = Array.from({ length: 25 }, () => [null, "Projects", "New client", null, null, null, null, null, ...Array(12).fill(1_000)]);
    grid.splice(6, 0, ...extra); // 25 new client rows above Summary
    const result = parseMonthlyProfit(grid, { year: 2026 });
    expect(result.monthlyProfit["2026-03"]).toBe(151_826);
  });

  it("keys months by the year it is told, not the sheet", () => {
    const result = parseMonthlyProfit(projectionsGrid(), { year: 2027 });
    expect(Object.keys(result.monthlyProfit)[0]).toBe("2027-01");
  });

  it("reports months whose cell is blank rather than inventing a zero", () => {
    const grid = projectionsGrid();
    const profitRow = grid.find((r) => r[2] === "Projected Operating Profit")!;
    profitRow[8 + 6] = ""; // blank out July
    profitRow[8 + 7] = "#REF!";
    const result = parseMonthlyProfit(grid, { year: 2026 });
    expect(result.missingMonths).toEqual(["2026-07", "2026-08"]);
    expect(result.monthlyProfit["2026-07"]).toBeUndefined();
  });

  it("matches a label that has picked up a trailing space or note", () => {
    const grid = projectionsGrid();
    const profitRow = grid.find((r) => r[2] === "Projected Operating Profit")!;
    profitRow[2] = "Projected Operating Profit (before tax)";
    expect(parseMonthlyProfit(grid, { year: 2026 }).monthlyProfit["2026-03"]).toBe(151_826);
  });

  it("throws a fixable error when the row is renamed away", () => {
    const grid = projectionsGrid();
    const profitRow = grid.find((r) => r[2] === "Projected Operating Profit")!;
    profitRow[2] = "Contribution Margin";
    expect(() => parseMonthlyProfit(grid, { year: 2026 })).toThrow(ProfitRowNotFoundError);
    expect(() => parseMonthlyProfit(grid, { year: 2026 })).toThrow(/PROJECTIONS_PROFIT_LABEL/);
  });

  it("throws when there is no month header anywhere", () => {
    const grid = [[null, "Summary", DEFAULT_PROFIT_LABEL, 1, 2, 3]];
    expect(() => parseMonthlyProfit(grid, { year: 2026 })).toThrow(/no Jan–Dec header/);
  });
});

describe("yearFromTabTitle", () => {
  it("pulls the year out of a tab name", () => {
    expect(yearFromTabTitle("2026")).toBe(2026);
    expect(yearFromTabTitle("2026 Projections")).toBe(2026);
    expect(yearFromTabTitle("Revenue Forecast 2027")).toBe(2027);
  });

  it("returns null when there is no year", () => {
    expect(yearFromTabTitle("Summary")).toBeNull();
    expect(yearFromTabTitle("")).toBeNull();
  });
});
