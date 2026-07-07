# Data model & integration plan

The forecasting engine (`src/lib/engine`) is deliberately storage-agnostic: it
takes a plain `ForecastInput` and returns a `ForecastResult`. This document
sketches the Supabase (Postgres) schema that feeds it and the sync layer that
keeps that data fresh. Nothing here is built yet — it's the map for phases 1–4.

## Principles

- **One normalized table per source**, each row stamped with `synced_at` and a
  `source` so the UI can show freshness and a stale/broken feed is obvious.
- **Read-only ingestion.** Sync jobs only ever `INSERT`/`UPSERT` mirrored
  records. Nothing writes back to QBO/Bill.com/the bank.
- **Independently toggleable modules.** Each integration is its own job +
  config row; disabling one never blocks the others or the forecast.
- **Manual override is first-class**, not a hack — especially for bank feeds,
  which are the flakiest. An override row supersedes a stale synced value and is
  itself stamped and attributed.

## Tables (sketch)

```
accounts            -- the 5 bank accounts (Checking …0377, Savings …1535, HYSA,
                    --   Shareholder …8987, Production): id, name, mask, kind, active
bank_balances       -- account_id, balance, as_of, source ('plaid'|'manual'|…),
                    --   synced_at, is_override, entered_by        ← real bank balance,
                    --   NOT QBO's (QBO ignores unreconciled txns)
ar_invoices         -- from QBO: customer, amount, issued_at, due_at, status,
                    --   is_overdue, expected_payment_at, synced_at
ap_bills            -- from Bill.com: vendor, amount, due_at, scheduled_pay_at,
                    --   approval_status, synced_at
other_withdrawals   -- MANUAL judgment items: owner distributions, tax set-asides,
                    --   the monthly Brandy payment. category, amount, date, memo
pipeline_deals      -- from CRM: name, value, probability, expected_close_at,
                    --   payment_terms, collection_lag_days, stage, synced_at
payroll_roster      -- role, comp, start_date, end_date?, cadence  (import from the
                    --   Staff tab first; wire to the payroll provider later)
accruals            -- Bonus, Cordelle, Commission, Tax: name, balance, accrual_per_month
accrual_events      -- payouts/adjustments: accrual_id, date, amount
recurring_items     -- payroll runs, retainers, rent: category, amount, frequency,
                    --   start_date, end_date?
scenarios           -- id, name, description, base_snapshot_id, created_by
scenario_levers     -- scenario_id, kind, params (jsonb)  ← mirrors engine `Lever`
forecast_runs       -- anchor_date, input_snapshot (jsonb), result (jsonb), created_at
actual_snapshots    -- period, actual ending balance & category actuals for
                    --   forecast-vs-actual variance learning
sync_log            -- source, started_at, finished_at, status, rows, error   ← powers
                    --   the "last synced / broken feed" UI
```

Mapping to the engine: `ar_invoices` + `ap_bills` + `other_withdrawals` →
`CashEvent[]`; `recurring_items` → `RecurringItem[]`; `pipeline_deals` →
`PipelineDeal[]`; `accruals`/`accrual_events` → `Accrual[]`; `bank_balances`
(latest per account, override-aware) → `BankAccount[].beginningBalance`.

## Sheet → engine mapping (verified against the actual xlsx)

The existing sheet's mechanics, confirmed by parsing every tab. The sync layer
should reproduce these so old and new reconcile line-for-line:

- **Bank accounts.** Operating cash = **Checking …0377 + Savings …1535 only**
  (Cash Flow row 35 = `D29+D30`). HYSA, Shareholder …8987, and Production are
  tracked but `operating: false`. The Shareholder account holds the accrual
  balances (rows 44–48: Bonus, Cordelle, Commission, Tax). Real balances are
  hand-keyed from QBO's Banking dashboard — **not** QBO's book balance
  (ignores unreconciled txns). → this is exactly what the bank aggregator sync
  replaces.
- **AR (`Accounts Receivable` tab).** `G` = Open Balance (the amount used),
  `E` = due date, `I` = expected payment date (`=due, or today if past due`),
  `K` = status (`PAST DUE` if pushed / `unsent` / `CURRENT`). Current AR sums
  `G` where `K="CURRENT"` and `I` in the week; Overdue AR sums `K="PAST DUE"`
  with a one-week offset. Contract terms are 15 days but aging runs ~30 →
  sensible default `collection_lag_days`.
- **Pipeline & Not-Sent (`Not Yet Booked` tab).** Rows 3–38 = Won future
  invoices → "Not Sent Invoiced". Rows 41–75 = Tentative → "Pipeline"
  (toggleable). `B` = due date (cash-landing date), `F` = amount. The sheet
  does **not** probability-weight; the CRM sync will supply real
  stage/probability so pipeline becomes probability-weighted.
- **Other Withdrawals (manual).** Funds-out dates by type: Brandy Payment
  (18,693/mo) → 1st of month; Tax Payment → 15th; Prebill → `EOMONTH+75`;
  Distribution → 1st. These stay manual (judgment items).
- **AP (`Accounts Payable` tab).** `O` = amount, `T` = pay date. Bills already
  overdue as of the update date are swept into the first projected week.
- **Burn.** Hard-keyed at 440,000/mo (row 40) → `settings.monthlyBurnOverride`.
- **Timeline.** All-weekly (~84 week columns); monthly is an `eomonth`
  reference only. The engine can reproduce this (`weeklyPeriods: N,
  monthlyPeriods: 0`) or use the mixed weekly+monthly horizon + `monthlyRollup`.

## Sync layer

One scheduled job per source (Vercel Cron or Supabase scheduled function),
nightly + on-demand refresh, each writing normalized rows and a `sync_log`
entry. Tokens live in Supabase/Vercel secrets — never in the repo.

| Source | Auth | Notes / friction |
| --- | --- | --- |
| CRM | direct DB read / internal API | easiest — our own data; do first |
| QuickBooks Online | OAuth2 (Intuit app), token auto-refresh | sandbox → prod needs Intuit review (days). Pull A/R Aging Detail + invoices. |
| Bill.com | API key | access has lead time — request now |
| Bank aggregator | Plaid / Teller / MX / Finicity | flakiest; feeds need periodic re-auth/MFA. Detect stale loudly; allow manual override. Confirm all 5 banks are covered before committing. |
| Payroll | provider API (later) | roster changes are infrequent; low urgency |

## Configurable account inclusion (settings)

Which accounts count toward *operating cash* is a **setting**, not hardcoded.
Each `accounts` row carries `include_in_operating` (engine: `BankAccount.operating`).
The forecast returns `bankTotals { operating, excluded, total }` so a settings
page can show and toggle inclusion. Default matches the sheet: Checking …0377 +
Savings …1535 operating; HYSA / Shareholder …8987 / Production excluded.

## Financial-model integration (salaries & budgets)

The `Brains - Financial Model.xlsx` should feed the cash-flow tool, but **a
budget/plan is not committed cash**. The engine enforces this with a `basis`
dimension on every cash stream: `committed` (real, owed — AP, actual payroll,
signed AR) vs `budgeted` (model plan). The forecast includes `budgeted` streams
only when `includeBudgeted` is on — so the two tools speak without a plan
silently moving the runway number.

- **Staff tab → payroll.** `staffToPayroll()` (`adapters/staff.ts`) maps roster
  rows — annual salary, DOH, DOT, scheduled raise (`salaryChangeDate` +
  `newSalary`), cost center — into monthly payroll `RecurringItem`s. Reproduces
  the model's per-month matrix logic (raise splits into pre/post items;
  termination caps the end date). Salaries are **gross** — pass `loadFactor`
  (~1.15) to approximate employer burden, or rely on the payroll-provider sync
  for loaded actuals. Active staff can be tagged `committed` while future hires
  stay `budgeted` via `basisFor`. The Staff tab also has Scenario 1/2/3 salary
  columns → map to engine scenario levers.
- **2026 Budget tab → opex.** P&L/accrual-based, monthly by category. Bring in
  as `budgeted`-basis recurring items (behind `includeBudgeted`), and only the
  lines that are actually cash — strip non-cash (depreciation), and apply timing
  where budget ≠ cash. The `Mapping` tab maps GL accounts → categories.

## Open questions (from the brief §9)

1. CRM stack/DB — read pipeline tables directly or via an API? Which fields map
   to value / probability / expected close / payment terms?
2. QBO + Bill.com API access — start approvals now (they set the timeline).
3. Which bank aggregator, and are all five banks covered?
4. SSO / internal auth — use Supabase Auth with the org's identity provider?

Answered so far: **stack = Vercel + Supabase + GoDaddy; no external API access
yet; the sheet will be shared for line-for-line reconciliation.**
