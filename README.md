# Brains Cash Flow & Scenario Planning

Internal tool that replaces our weekly cash-flow spreadsheet and Float. It
auto-pulls AR (QuickBooks Online), AP (Bill.com), live bank balances (via an
aggregator), and pipeline (our CRM), projects cash on a rolling basis, and lets
us model hiring, layoffs, client churn, and pipeline changes in real time.

> **Automation is the whole point.** AR, AP, and bank balances refresh on a
> schedule with no manual step. If a value still needs weekly copy/paste, our
> accountant can already do that in the sheet — there's no ROI. The only
> intentionally-manual inputs are forward-looking judgment items (owner
> distributions, tax set-asides, one-off "Other Withdrawals").

## Non-negotiables

- **Read-only** against every financial system. The app never initiates a
  payment, transfer, or trade.
- **No silent stale data.** Every synced value carries a "last synced" stamp;
  broken/stale feeds are surfaced loudly, with a manual-override fallback for
  bank feeds so a dropped connection never blocks a forecast.
- **The old spreadsheet is the spec.** We run in parallel and reconcile
  line-for-line before retiring it.

## Stack

- **Frontend / hosting:** TypeScript + Next.js on Vercel
- **Database / auth:** Supabase (Postgres + Auth), internal-only
- **Domain:** GoDaddy
- **Forecasting engine:** a pure, dependency-free TypeScript module
  (`src/lib/engine`) — no I/O, no clock, no randomness — so it can be trusted
  and unit-tested independently of the UI and integrations.

## Current status (Phase 1, in progress)

| Piece | State |
| --- | --- |
| Forecasting engine + scenario layer | ✅ built & unit-tested (`src/lib/engine`) |
| CRM pipeline read | ⬜ pending CRM access |
| QuickBooks AR sync | ⬜ pending Intuit app approval |
| Bill.com AP sync | ⬜ pending API access |
| Bank balances (aggregator) | ⬜ pending aggregator + coverage check |
| Next.js dashboard (chart, KPIs, runway, alerts, narrative, scenarios, editable assumptions) | ✅ working v1 (runs on editable sample data, persisted locally) |

**No external API access exists yet.** Credential approvals (QBO, Bill.com,
bank aggregator) have lead times and set the timeline — start them day one. The
engine is built first precisely because it needs none of them.

## The forecasting engine

Pure module under [`src/lib/engine`](src/lib/engine). Public API is
[`src/lib/engine/index.ts`](src/lib/engine/index.ts).

```ts
import { forecast, runScenario, compareScenarios, narrate } from "@engine/index.js";

const input = {
  anchorDate: "2026-07-06",            // "today" — passed in, never read from a clock
  bankAccounts: [{ id: "chk", name: "Checking …0377", beginningBalance: 250_000 }],
  events: [/* AR invoices, AP bills, manual withdrawals — dated cash movements */],
  recurring: [/* payroll runs, retainers, rent */],
  pipeline: [/* CRM deals: value, probability, expectedCloseDate, collectionLagDays */],
  includePipeline: true,               // the sheet's pipeline toggle
  accruals: [/* Bonus, Cordelle, Commission, Tax */],
};

const result = forecast(input);
// result.periods       → weekly (≥13) then monthly (12) series, mixed granularity
// result.monthlyBurn   → average monthly burn
// result.reserveTarget → 3× burn (configurable)
// result.runwayMonths  → timing-aware months until cash hits $0
// result.alerts        → e.g. ending < $0 while overdue AR outstanding
```

Everything is derived from a flat list of dated cash events, bucketed into a
mixed-granularity timeline (weekly near-term, monthly later — like Float).

### Line-item taxonomy (matches the sheet)

- **Receipts:** Current AR · Overdue AR (separate) · Not-Sent/Not-Yet-Invoiced ·
  Pipeline (toggle) · LOC draw
- **Disbursements:** Payroll · Operating Expense · American Express · Other
  Withdrawals · Accounts Payable · AP Estimate · Bonus Accruals
- **Accruals tracked over time:** Bonus · Cordelle · Commission · Tax

### Scenarios (first-class, not "PLAY rows")

Named, forkable, comparable. A scenario is a base input plus an ordered list of
pure levers:

- `hire` — role × comp × start, with an optional cost ramp
- `layoff` — remove a role from a date, with one-time severance
- `churn` — drop a client retainer from a month
- `pipelineSensitivity` — win-rate multiplier + slip expected-close by N days
- `collectionTiming` — speed up / slow down overdue AR collection

```ts
const withHire = runScenario(input, {
  id: "grow", name: "Aggressive hiring",
  levers: [{ kind: "hire", role: "Sr Engineer", annualComp: 240_000, startDate: "2026-09-01" }],
});
const diff = compareScenarios(forecast(input), withHire); // per-period Δ + runway Δ
```

### Reconciled against the sheet ✓

The engine was parsed against `Brains - Weekly Cash Flow.xlsx` and matched to
its actual formulas (details in [docs/DATA_MODEL.md](docs/DATA_MODEL.md)):

- **Operating cash = Checking …0377 + Savings …1535 only** (Cash Flow row 35).
  HYSA, Shareholder …8987, and Production are tracked (`totalBankBalance`) but
  excluded from the operating beginning balance/runway — set `operating: false`
  on those accounts. The Shareholder account holds the accrual balances.
- **Monthly burn is a hard-keyed judgment input** ($440k in the sheet, row 40),
  set via `settings.monthlyBurnOverride`. The engine still computes a
  projection-derived `monthlyBurnComputed` as a cross-check.
- **Reserve target** = 3× burn; **excess/shortfall** = ending − reserve, per
  period (rows 41–42).
- **Alert rule** — ending balance **≤ $0** AND overdue AR outstanding (the
  sheet's conditional formatting on rows 38 and 9).
- **Runway** is an engine addition (the sheet has no runway cell): both a naive
  `startingCash / burn` (`runwayMonthsSimple`) and a timing-aware
  crossing-of-zero (`runwayMonths`).

### Financial-model integration & configurable accounts

- **Committed vs budgeted.** Every cash stream carries a `basis`
  (`committed` | `budgeted`). The forecast is **committed-only by default**;
  set `includeBudgeted: true` to fold in the financial model's plan (salaries,
  budgeted opex). This is the guardrail so a budget never silently moves the
  runway number.
- **Staff → payroll.** `staffToPayroll()` maps the model's roster (salary, hire
  date, termination, scheduled raises, cost center) into payroll inputs, with a
  `loadFactor` for employer burden and per-person `committed`/`budgeted`
  tagging. See [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
- **Which accounts count as operating cash is a setting** (`operating` per
  account). The result's `bankTotals { operating, excluded, total }` drives a
  settings page; the default mirrors the sheet (Checking + Savings only).

## Development

```bash
npm install
npm run dev        # Next.js dashboard at http://localhost:3000
npm test           # vitest — engine unit tests
npm run typecheck  # tsc --noEmit (strict)
npm run build      # production build
```

The **engine** (`src/lib/engine`) has zero runtime dependencies. The **app**
(`src/app`, `src/components`) is Next.js + React on top of it.

### The v1 dashboard

Runs entirely on editable inputs (seeded with the real bank balances + sample
flows), persisted to the browser — no integrations required yet. Float-inspired
UX:

- **Cash chart** with the reserve-target line and a dated **cash-out marker**,
  plus **multiple scenario overlays toggled on/off** at once (each its own line).
- **KPIs** — operating cash, runway, burn, reserve, cash-vs-reserve.
- **Cash-flow matrix** — categories grouped into Cash In / Cash Out (collapsible,
  with subtotals) across weekly/monthly periods, on an Opening → Net → Closing
  balance spine, matching the sheet's mental model.
- **Alerts**, a deterministic plain-English **narrative**, a **scenario compare**
  table (runway / cash-at-horizon / Δ-vs-base, color-matched to the chart), and
  an **assumptions editor**.

State lives in `src/lib/data/store.tsx` — the seam where a Supabase-backed data
layer and the live syncs drop in.

## Roadmap

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the database schema and the
integration-module plan. Build phases (each ships something real, retiring the
biggest risk — a live financial sync — first):

1. **Engine + CRM + QBO AR** ← engine done; CRM & QBO next.
2. Bill.com AP sync.
3. Bank balances via aggregator, with manual-override fallback.
4. Payroll provider sync, deeper variance learning, reporting.

Integrations are independently toggleable modules so each ships the moment its
credentials are ready, and one broken feed never takes the app down.
