/**
 * Projections sheet → monthly operating profit.
 *
 * Pure grid parsing, no I/O, so the fragile part of the integration is unit
 * tested against the sheet's real shape.
 *
 * The lookup is **label-driven, never cell-addressed**. The Summary block sits
 * below a variable number of client rows — every retainer, project, and
 * production line pushes it down — so a hardcoded `B71` would silently read the
 * wrong row the first time someone adds a client. Instead we find the row by
 * its label and the columns by the nearest Jan–Dec header above it.
 */

const MONTH_ABBREVS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

/** The Summary row the tax calculation starts from. */
export const DEFAULT_PROFIT_LABEL = "Projected Operating Profit";

/**
 * Rows folded into the tax base on top of the profit row.
 *
 * Default is the below-the-line expenses that are genuinely deductible —
 * depreciation, bad debt, partner buyouts, interest. Deliberately NOT
 * "Cash (Have to) Expenses": partner distributions are a distribution of
 * profit rather than an expense against it, and loan principal is not
 * deductible either, so folding that row in would understate taxable income.
 */
export const DEFAULT_ADJUSTMENT_LABELS = ["Other Expenses without billables"];

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parse a cell into a number. `UNFORMATTED_VALUE` gives real numbers for real
 * numbers, but a cell that's been typed as text (or carries a stray label)
 * arrives as a string like "-$21,564" or "(21,564)" — both mean negative.
 */
export function parseNumericCell(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "" || raw === "-" || raw === "—") return null;
  // The Cash Expenses rows are formatted "$ (16,750)", so the parens are not
  // necessarily the outermost characters — look for them anywhere.
  const parenthesized = raw.includes("(") && raw.includes(")");
  const cleaned = raw.replace(/[()$,\s]/g, "").replace(/[%]$/, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return parenthesized ? -Math.abs(n) : n;
}

/** The 1-based month a header cell names, or null. Handles "Jan", "January",
 *  "Jan-26", and date-formatted headers like "1/1/2026". */
export function monthOfHeaderCell(value: unknown): number | null {
  const text = normalize(value);
  if (text === "") return null;
  const byName = MONTH_ABBREVS.findIndex((m) => text.startsWith(m));
  if (byName !== -1) return byName + 1;
  const slash = /^(\d{1,2})[/-]\d{1,2}[/-]\d{2,4}$/.exec(text);
  if (slash) {
    const m = Number(slash[1]);
    if (m >= 1 && m <= 12) return m;
  }
  return null;
}

/**
 * Column index for each month in a header row, or null if the row isn't one.
 * Requires the months to appear left to right in calendar order — the sheet
 * repeats Jan–Dec for several blocks and years, and this keeps two blocks side
 * by side from being spliced into one bogus header.
 */
export function monthColumnsInRow(row: unknown[]): (number | null)[] | null {
  const cols: (number | null)[] = Array(12).fill(null);
  let found = 0;
  let lastCol = -1;
  for (let c = 0; c < row.length; c++) {
    const month = monthOfHeaderCell(row[c]);
    if (month === null) continue;
    if (cols[month - 1] !== null) continue; // already have this month
    if (c <= lastCol) continue; // out of order — a different block
    cols[month - 1] = c;
    lastCol = c;
    found++;
  }
  return found >= 6 ? cols : null;
}

export interface ProfitParseResult {
  /** Operating profit keyed "YYYY-MM". Only months with a real value. */
  monthlyProfit: Record<string, number>;
  /** The label text actually matched, as written in the sheet. */
  matchedLabel: string;
  /** 0-based grid row the figures came from (for troubleshooting). */
  rowIndex: number;
  /** 0-based grid row the Jan–Dec header came from. */
  headerRowIndex: number;
  /** Months in the header that had no usable value. */
  missingMonths: string[];
}

export class ProfitRowNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfitRowNotFoundError";
  }
}

/**
 * Find the row whose label matches, preferring an exact (normalized) match over
 * a substring one. Substring is the fallback because the sheet's labels pick up
 * trailing notes over time ("Projected Operating Profit " with a stray space,
 * or a footnote marker).
 */
function findLabelRow(grid: unknown[][], label: string): { row: number; text: string } | null {
  const target = normalize(label);
  let fallback: { row: number; text: string } | null = null;
  for (let r = 0; r < grid.length; r++) {
    for (const cell of grid[r] ?? []) {
      const text = normalize(cell);
      if (text === "") continue;
      if (text === target) return { row: r, text: String(cell).trim() };
      if (fallback === null && text.includes(target)) {
        fallback = { row: r, text: String(cell).trim() };
      }
    }
  }
  return fallback;
}

/** The nearest Jan–Dec header at or above `fromRow`, else the first one below. */
function findHeaderRow(grid: unknown[][], fromRow: number): { row: number; cols: (number | null)[] } | null {
  for (let r = fromRow; r >= 0; r--) {
    const cols = monthColumnsInRow(grid[r] ?? []);
    if (cols) return { row: r, cols };
  }
  for (let r = fromRow + 1; r < grid.length; r++) {
    const cols = monthColumnsInRow(grid[r] ?? []);
    if (cols) return { row: r, cols };
  }
  return null;
}

/**
 * Pull monthly operating profit out of a projections tab.
 *
 * @param grid  Raw `values` from the Sheets API (rows of cells).
 * @param label Row label to read, e.g. "Projected Operating Profit".
 * @param year  Calendar year the tab covers — the sheet's headers say only
 *              "Jan".."Dec", so the year comes from the tab title / config.
 */
export function parseMonthlyProfit(
  grid: unknown[][],
  { label = DEFAULT_PROFIT_LABEL, year }: { label?: string; year: number },
): ProfitParseResult {
  const found = findLabelRow(grid, label);
  if (!found) {
    throw new ProfitRowNotFoundError(
      `No row labelled "${label}" in the projections tab. Rename the row back, or update PROJECTIONS_PROFIT_LABEL.`,
    );
  }
  const header = findHeaderRow(grid, found.row);
  if (!header) {
    throw new ProfitRowNotFoundError(
      `Found "${found.text}" at row ${found.row + 1} but no Jan–Dec header row to read months from.`,
    );
  }

  const row = grid[found.row] ?? [];
  const monthlyProfit: Record<string, number> = {};
  const missingMonths: string[] = [];
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, "0")}`;
    const col = header.cols[m];
    if (col === null || col === undefined) {
      missingMonths.push(key);
      continue;
    }
    const value = parseNumericCell(row[col]);
    if (value === null) missingMonths.push(key);
    else monthlyProfit[key] = value;
  }

  return {
    monthlyProfit,
    matchedLabel: found.text,
    rowIndex: found.row,
    headerRowIndex: header.row,
    missingMonths,
  };
}

/** The 4-digit year in a tab title ("2026 Projections" → 2026), else null. */
/** One located row of the sheet, with its months resolved. */
export interface SheetRow {
  /** The label as actually written in the sheet. */
  label: string;
  /** Values keyed "YYYY-MM". Only months with a usable figure. */
  monthly: Record<string, number>;
  /** Months the row had no usable value for. */
  missingMonths: string[];
  /** Sum across the year — handy for showing the sign at a glance. */
  total: number;
}

export interface TaxBaseParse {
  /** What the tax rate is applied to: profit combined with each adjustment. */
  taxBase: Record<string, number>;
  /** The starting profit row. */
  profit: SheetRow;
  /** Rows folded in, in configured order. */
  adjustments: SheetRow[];
}

function toSheetRow(parsed: ProfitParseResult): SheetRow {
  return {
    label: parsed.matchedLabel,
    monthly: parsed.monthlyProfit,
    missingMonths: parsed.missingMonths,
    total: Object.values(parsed.monthlyProfit).reduce((a, b) => a + b, 0),
  };
}

/**
 * Build the tax base: the profit row with each adjustment row folded in.
 *
 * Rows are combined **using the sign as written in the sheet**, not negated.
 * The expense rows here are already stored negative (-26,709 for January), so
 * adding them reduces the base — which is what "subtract Other Expenses" means
 * in practice. Negating them instead would silently double the figure back the
 * other way, turning a $145k deduction into a $145k addition, so this is
 * asserted in the tests rather than left to inference.
 *
 * A missing adjustment row is fatal: quietly taxing the gross profit because a
 * row got renamed is exactly the failure this whole label-driven lookup exists
 * to prevent.
 */
export function parseTaxBase(
  grid: unknown[][],
  {
    profitLabel = DEFAULT_PROFIT_LABEL,
    adjustmentLabels = DEFAULT_ADJUSTMENT_LABELS,
    year,
  }: { profitLabel?: string; adjustmentLabels?: string[]; year: number },
): TaxBaseParse {
  const profit = toSheetRow(parseMonthlyProfit(grid, { label: profitLabel, year }));
  const adjustments = adjustmentLabels
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => toSheetRow(parseMonthlyProfit(grid, { label, year })));

  const taxBase: Record<string, number> = {};
  for (const [month, value] of Object.entries(profit.monthly)) {
    taxBase[month] = adjustments.reduce((sum, a) => sum + (a.monthly[month] ?? 0), value);
  }
  return { taxBase, profit, adjustments };
}

export function yearFromTabTitle(title: string): number | null {
  const match = /(20\d{2})/.exec(title);
  return match ? Number(match[1]) : null;
}
