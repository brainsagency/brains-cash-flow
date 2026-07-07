# Bill.com integration

**Bill.com is the AP source of truth** — it knows real payment timing and
approval status. QuickBooks Bills are pulled separately (by the QBO sync) and
used only to **validate** Bill.com: each Bill.com sync cross-checks open-AP
totals against QBO and shows an in-sync ✅ / delta 🟡 banner.

## What's implemented
- v3 API client (`src/lib/integrations/billdotcom/client.ts`): session-based
  login (`POST /connect/v3/login` with devKey + org creds → `sessionId`),
  paged `GET /v3/bills` + `GET /v3/vendors` (for vendor names). Sessions
  expire ~35 min idle, so each sync logs in fresh.
- Mapping (`map.ts`, unit-tested): unpaid bills → `accountsPayable` events;
  amount, due date (past-due swept to today), vendor + invoice number label.
  Fully-paid bills excluded.
- Reconciliation (`reconcile.ts`, unit-tested): Bill.com AP total vs QBO Bills
  total, with delta + in-sync flag.
- Routes: `POST /api/sync/billdotcom`, `GET /api/billdotcom/status`,
  `GET /api/billdotcom/data`.
- Storage: `bill_last_sync` (Supabase) or the local `.data/` file, same
  dual-backend store as QBO.
- UI: "Bill.com sync" panel in **Bills to Pay (AP)** with Refresh AP + the
  QuickBooks cross-check banner. Synced AP replaces manual `accountsPayable`
  everywhere (chart, matrix, runway); `apEstimate` and Other Withdrawals stay
  manual.

## Setup (sandbox)
1. Create a developer account at **developer.bill.com** → generate a **devKey**.
2. Note your sandbox **organizationId** and a sandbox **username/password**.
3. Add to `.env.local`:
   ```
   BILLDOTCOM_DEV_KEY=…
   BILLDOTCOM_ORG_ID=…
   BILLDOTCOM_USERNAME=…
   BILLDOTCOM_PASSWORD=…
   BILLDOTCOM_ENVIRONMENT=sandbox
   ```
4. Run the `bill_last_sync` table SQL (in `supabase/schema.sql`) if not already.
5. **Bills to Pay (AP)** → **Refresh AP**.

Base URLs: sandbox `https://gateway.stage.bill.com/connect`, production
`https://gateway.prod.bill.com/connect` (`BILLDOTCOM_ENVIRONMENT=production`).
Production API access requires approval from BILL — request early.
