# QuickBooks Online integration

Pulls **AR (open Invoices)** into the forecast and **AP (open Bills)** as a
validation set to reconcile against Bill.com. Read-only. One OAuth connection.

## What's implemented
- OAuth 2.0 connect flow — `GET /api/connect/qbo/start` → Intuit consent → `GET /api/connect/qbo/callback`
- Token storage + **auto-refresh** (refresh token rotates; the latest is always persisted)
- Sync — `POST /api/sync/qbo`: queries `Invoice` + `Bill` where `Balance > 0`, maps to engine `CashEvent`s
- Status/data — `GET /api/qbo/status`, `GET /api/qbo/data`
- UI — "QuickBooks sync" panel in **Invoices Due (AR)** (Connect / Refresh / last-synced)
- When connected, synced AR **replaces** manual current/overdue AR everywhere (chart, matrix, runway); the top badge flips to "QuickBooks AR live". Mapping is unit-tested (`src/lib/integrations/qbo/map.test.ts`).

## Setup (sandbox)
1. Create an app at **developer.intuit.com** with the `com.intuit.quickbooks.accounting` scope.
2. Under **Development → Keys & OAuth**, copy the Client ID / Secret, and add the redirect URI:
   `http://localhost:3000/api/connect/qbo/callback`
3. Create `.env.local`:
   ```
   QBO_CLIENT_ID=…
   QBO_CLIENT_SECRET=…
   QBO_ENVIRONMENT=sandbox
   QBO_REDIRECT_URI=http://localhost:3000/api/connect/qbo/callback
   ```
4. `npm run dev` → **Invoices Due (AR)** → **Connect QuickBooks** → authorize the sandbox company → **Refresh AR**.

## Mapping (matches the sheet)
- Invoice → `currentAR` / `overdueAR`, amount = `Balance` (open), date = `DueDate` (past-due swept to today).
- Bill → `accountsPayable` (validation only), same rules.

## Going to production
- Production keys unlock after Intuit's **app review** (a few days) — start that early.
- Set `QBO_ENVIRONMENT=production` and the production `QBO_REDIRECT_URI` (your Vercel domain).
- **Storage:** the dev store writes tokens/sync to `.data/qbo.json` (gitignored) — fine for local, but Vercel's filesystem is ephemeral. Swap `src/lib/integrations/store.ts` for a Supabase implementation (connections + ar_invoices + ap_bills + sync_log; tokens in Vault) before deploying. The function signatures are the contract.
- Schedule `POST /api/sync/qbo` via Vercel Cron for nightly refresh.
