import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/cron.js";
import {
  SheetsAuthError,
  getAccessToken,
  getTabValues,
  listTabs,
  resolveTab,
  sheetsConfigFromEnv,
} from "@/lib/integrations/sheets/client.js";
import {
  DEFAULT_ADJUSTMENT_LABELS,
  DEFAULT_PROFIT_LABEL,
  ProfitRowNotFoundError,
  parseTaxBase,
  yearFromTabTitle,
} from "@/lib/integrations/sheets/map.js";
import { appendLog, saveProjectionsSync } from "@/lib/integrations/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** UI-triggered sync (the page is already behind the auth gate). */
export function POST(_req: NextRequest) {
  return runProjectionsSync();
}

/** Cron-triggered sync (Vercel Cron issues GETs with the cron bearer). */
export function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return runProjectionsSync();
}

/**
 * Read monthly operating profit from the projections sheet and store it.
 *
 * Read-only, like every other feed: one `values.get` against a tab we were
 * explicitly shared into. Nothing is written back to the spreadsheet.
 */
async function runProjectionsSync() {
  const startedAt = new Date().toISOString();
  const cfg = sheetsConfigFromEnv();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "Projections sheet is not configured. Set GOOGLE_SHEETS_CLIENT_EMAIL, " +
          "GOOGLE_SHEETS_PRIVATE_KEY, and PROJECTIONS_SHEET_ID.",
      },
      { status: 409 },
    );
  }

  // The year drives both which tab to read and how months are keyed. Explicit
  // config wins; otherwise follow the calendar, so January needs no touch-up.
  const targetYear = Number(process.env.PROJECTIONS_YEAR) || new Date().getUTCFullYear();
  const label = process.env.PROJECTIONS_PROFIT_LABEL || DEFAULT_PROFIT_LABEL;
  // Rows folded into the tax base on top of the profit row. Comma-separated;
  // set to an empty string to tax the profit row alone.
  const adjustmentLabels =
    process.env.PROJECTIONS_ADJUSTMENT_LABELS === undefined
      ? DEFAULT_ADJUSTMENT_LABELS
      : process.env.PROJECTIONS_ADJUSTMENT_LABELS.split(",");

  try {
    const token = await getAccessToken(cfg);
    const tabs = await listTabs(cfg, token);
    const tab = resolveTab(tabs, cfg.tabTitle, targetYear);
    if (!tab) {
      throw new Error("The spreadsheet has no readable tabs.");
    }

    const grid = await getTabValues(cfg, token, tab.title);
    // A tab named for its year is more trustworthy than the calendar — reading
    // the "2026" tab in January 2027 should still key months to 2026.
    const year = yearFromTabTitle(tab.title) ?? targetYear;
    const parsed = parseTaxBase(grid, { profitLabel: label, adjustmentLabels, year });

    const result = {
      syncedAt: new Date().toISOString(),
      spreadsheetId: cfg.spreadsheetId,
      tabTitle: tab.title,
      matchedLabel: parsed.profit.label,
      year,
      monthlyProfit: parsed.taxBase,
      missingMonths: parsed.profit.missingMonths,
      components: [
        { label: parsed.profit.label, kind: "profit" as const, monthly: parsed.profit.monthly, total: parsed.profit.total },
        ...parsed.adjustments.map((a) => ({
          label: a.label,
          kind: "adjustment" as const,
          monthly: a.monthly,
          total: a.total,
        })),
      ],
    };
    await saveProjectionsSync(result);
    await appendLog({
      source: "projections",
      startedAt,
      finishedAt: result.syncedAt,
      status: "ok",
      message:
        `${tab.title} · "${parsed.profit.label}"` +
        parsed.adjustments.map((a) => ` less "${a.label}"`).join("") +
        ` · ${Object.keys(parsed.taxBase).length}/12 months` +
        (parsed.profit.missingMonths.length > 0 ? ` · missing ${parsed.profit.missingMonths.join(", ")}` : ""),
    });

    return NextResponse.json({
      ok: true,
      syncedAt: result.syncedAt,
      tabTitle: tab.title,
      matchedLabel: parsed.profit.label,
      adjustments: parsed.adjustments.map((a) => ({ label: a.label, total: a.total })),
      year,
      monthCount: Object.keys(parsed.taxBase).length,
      missingMonths: parsed.profit.missingMonths,
    });
  } catch (e) {
    const message = (e as Error).message;
    await appendLog({
      source: "projections",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "error",
      message,
    });
    // 401 = fix the sharing/credentials; 422 = the sheet's shape moved and a
    // human has to decide what to read; 502 = transient, the cron will retry.
    const status = e instanceof SheetsAuthError ? 401 : e instanceof ProfitRowNotFoundError ? 422 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
