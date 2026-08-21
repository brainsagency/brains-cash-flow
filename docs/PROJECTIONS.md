# Projections sheet → quarterly taxes

The cash-flow tool has no tax line of its own to compute. It reads **monthly
operating profit** out of the *Brains Projections* Google Sheet, applies a
blended rate, and turns the result into dated cash out on the IRS estimated-tax
due dates.

This is the third link between the workbooks and the tool, alongside `Staff` →
payroll cash and `Billing Schedule` → won-not-yet-invoiced revenue. It follows
the same rule as those two: **consume a cash-relevant output, never rebuild the
accounting machinery.** The tool does not model revenue, COGS, or overhead — it
reads one row.

## What it reads

| | |
| --- | --- |
| Spreadsheet | [Brains Projections 2026](https://docs.google.com/spreadsheets/d/1_VPc5YpGnZXLjfP6EvJ0CEuZhfnaGWYmAg61CsHsNIM/edit) |
| Tab | the one whose title contains the target year (override with `PROJECTIONS_SHEET_TAB`) |
| Row | `Projected Operating Profit` on the Summary block |
| Columns | the Jan–Dec header nearest above that row |

The row is found **by its label, never by cell address**. The Summary block sits
below every retainer, project, and production line, so it moves down the sheet
every time a client is added — a hardcoded `B71` would silently start reading
the wrong row. If someone renames the row, the sync fails loudly with a 422 and
names the env var to change rather than importing a wrong number.

`Projected Operating Profit` is the same figure that feeds the financial model's
`Net Operating Income`, and the model's own `Federal Estimated Taxes (35%)` row
is computed off it — so the tool and the model agree by construction.

## Setup (one time)

The sync runs on a nightly cron with nobody signed in, so it authenticates as a
**Google Cloud service account**, not with anyone's Google SSO token.

1. In the [Google Cloud console](https://console.cloud.google.com/), create (or
   pick) a project and enable the **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account.** No project roles
   are needed — access is granted by sharing the file, not by IAM.
3. On the service account, **Keys → Add key → Create new key → JSON**. Download it.
4. Open the projections spreadsheet and **Share** it with the service account's
   email (`…@….iam.gserviceaccount.com`) as **Viewer**. The sheet is owned by
   Ben, so this step may need him.
5. Set the env vars, locally in `.env.local` and in Vercel:

   ```
   GOOGLE_SHEETS_CLIENT_EMAIL=<client_email from the JSON>
   GOOGLE_SHEETS_PRIVATE_KEY="<private_key from the JSON, \n escapes intact>"
   PROJECTIONS_SHEET_ID=1_VPc5YpGnZXLjfP6EvJ0CEuZhfnaGWYmAg61CsHsNIM
   ```

   Keep the private key's `\n` sequences as literal backslash-n and wrap the
   value in quotes; the client unescapes them. A mangled PEM is the most common
   failure and reports itself as such.
6. Run the schema migration in `supabase/schema.sql` (it adds
   `projections_last_sync`).
7. Open **Taxes** in the app and hit **Sync now**.

Optional:

| Var | Default |
| --- | --- |
| `PROJECTIONS_SHEET_TAB` | pick the tab whose title contains the year |
| `PROJECTIONS_YEAR` | the current calendar year |
| `PROJECTIONS_PROFIT_LABEL` | `Projected Operating Profit` |

## How the tax number is worked out

Each due date pays the **year-to-date true-up**, floored at zero:

```
liability = max(0, YTD operating profit × rate)
payment   = max(0, liability − everything already scheduled that year)
```

The IRS periods are **not even quarters** — they run 3, 2, 3, and 4 months:

| Period | Months covered | Due |
| --- | --- | --- |
| Q1 | Jan – Mar | Apr 15 |
| Q2 | Apr – May | Jun 15 |
| Q3 | Jun – Aug | Sep 15 |
| Q4 | Sep – Dec | Jan 15 (following year) |

Running YTD rather than quarter-by-quarter matters here, because the business
swings between profit and loss month to month. On the 2026 figures, a strong
Q1–Q2 schedules ~$99.8k by June, then the June/July losses drop the YTD
liability below what's already been paid — so Q3 and Q4 correctly owe **nothing**
instead of billing tax on months that lost money. The floor at zero reflects
that the IRS doesn't refund mid-year; an overpayment suppresses later
installments and settles at filing.

### Recording payments

Each installment has a **Record** button. What you enter always beats the
computed amount, and the entry has two modes:

- **Already paid** — the cash has left. Dropped from the forecast, and credited
  against the running liability.
- **Planned** — an amount you have decided to pay instead of what the true-up
  suggests. Still leaves the bank, on the date you give.

Either way, later quarters true up against **what was actually applied**, not
what was theoretically owed. Underpay Q1 by $10,771 and Q2 rises from $49,074
to $59,845 — the shortfall rolls forward. Overpay and the next quarter shrinks.
That is the difference between tracking payments and just flagging them paid.

The schedule shows the whole chain per quarter: profit for that period alone,
the liability it added (negative when the quarter lost money), the running
liability YTD, what had been applied before it, the payment, and what is still
owed after it.

Row status distinguishes three different kinds of zero, which is easy to
conflate: **Skipped** (you recorded $0 and liability is still outstanding),
**Unpaid** (owed with nothing scheduled), and **Nothing owed** (payments already
cover what has accrued).

### Skipping instalments, and the overshoot warning

Because every instalment is a catch-up on the year so far, skipping the early
ones does not reduce what you pay — it concentrates it into the next one. That
matters in a year that turns down: the catch-up is sized on profit earned *to
that point*, so if the rest of the year loses money you can end up scheduling
far more than the year actually owes.

The summary strip flags this as **"paying as scheduled overshoots the year by
$X"**. The 2026 case is exactly this shape: nothing paid in Q1 or Q2, so the
15 Sep instalment is $67,841.74, while the full year is projected to owe only
$8,114.65 — a $59,727.10 overshoot that would sit with the IRS until filing.

The fix is to record a smaller **planned** amount on that row. Note that
skipping quarterly instalments can carry an underpayment penalty even when the
year nets out, so this is a question for the accountant, not just a cash call.

Figures display in dollars and cents. The maths carries a tenth of a cent
internally so nothing is lost across the running totals, which means a column
can read a fraction of a cent out when added up as printed.

Liability **accrued to date** counts every calendar month that has fully
elapsed, not the last closed quarter — quarter-based accrual runs up to three
months stale and reads as broken when it exceeds the full-year figure.

### Other controls

- **Blended tax rate** — defaults to 35%, matching the model's
  `Federal Estimated Taxes (35%)` row.
- **Paid through** — a blunt "everything before here is settled" cutoff, for
  when you don't want to enter amounts. A per-quarter record supersedes it.

Payments land on the **Taxes** disbursement line (its own line, like Freelance),
on `committed` basis — a tax payment is real cash on a known date, so it belongs
in the default forecast rather than behind the `includeBudgeted` toggle.

## Manual override

Any month can be typed over in the Taxes panel. A typed figure beats the sheet
and survives the nightly sync, so a known correction isn't clobbered — the month
is marked `✎` and **Use sheet values** drops all overrides at once.

This is also the escape hatch before the service account exists: type the twelve
numbers in and everything downstream works. A fresh install seeds the real 2026
figures for exactly that reason, which means they *are* overrides — hit **Use
sheet values** once the sync is live.

## What this does not do

- No state tax line. The single blended rate is meant to cover it; split it out
  if SC's pass-through tax gets material enough to track separately.
- No prior-year safe harbor. Real estimated payments are often sized off last
  year's liability instead of this year's income; this models current-year
  income only.
- Nothing is written back to the spreadsheet, and no payment is ever initiated.
  Read-only, like every other feed here.
