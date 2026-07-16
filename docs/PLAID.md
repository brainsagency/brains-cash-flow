# Plaid — bank balance sync

Balances-only integration. Link a bank once, then a sync pulls live account
balances and writes them into the tracked bank accounts, matched by **last-four
(mask)**, stamped as-of now. That's what clears the "update starting cash"
reconcile banner — no manual entry.

No transactions are pulled (yet). This only reads `/accounts/get` (balances),
which works with the enabled product and needs no separate Balance product.

## Setup

1. In the [Plaid dashboard](https://dashboard.plaid.com), grab your **client ID**
   and the **secret for the environment you're using** (the secret differs
   between Sandbox and Production). Plaid retired the standalone *development*
   environment — use **production** for live banks.
2. Product: Plaid rejects `balance` as a standalone Link product — it rides
   along with any other product. We request **`transactions`** purely to unlock
   balances (we only read balances via `/accounts/get`; no transactions are pulled).
   Set `PLAID_PRODUCTS` to whatever product your account has enabled if it's not
   Transactions (e.g. `auth`). Request/enable products at
   https://dashboard.plaid.com/overview/request-products.
3. Add to `.env.local` (never commit real secrets):

   ```
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=production   # or sandbox
   # Required for OAuth banks (Chase, etc.) — see below.
   PLAID_REDIRECT_URI=https://your-app.example.com/plaid-oauth
   ```

   On Vercel, add the same as encrypted env vars.
4. Run `supabase/schema.sql` so the `plaid_connection` and `bank_last_sync`
   tables exist (safe to re-run; it's all `create table if not exists`). Without
   Supabase configured, connection + last sync fall back to `.data/qbo.json`
   locally.

## Using it

In **Assumptions → Bank sync (Plaid)**:

1. **Connect bank** opens Plaid Link. Pick your institution and authorize.
2. On success the app exchanges the token server-side and immediately syncs.
3. **Sync balances** any time to pull fresh balances.

For a balance to land on an account, that account's **last-four** must match the
Plaid account's mask (edit it in the bank accounts list just above the panel).
Any Plaid account that doesn't match a tracked last-four is reported as
"unmatched" so you can add it.

## OAuth banks (Chase, Wells Fargo, Capital One, …)

Large US banks use OAuth: Plaid sends the user to the bank's own site and back.
This needs two things:

1. Set `PLAID_REDIRECT_URI` to the app's **`/plaid-oauth`** page (dev:
   `http://localhost:3000/plaid-oauth`; prod: the https URL).
2. Register that **exact** URL under **Allowed redirect URIs** in the Plaid
   dashboard (API settings). It must match character-for-character.

Flow: **Connect bank** stashes the Link token in `localStorage`, opens Link, and
the bank redirects back to `/plaid-oauth`. That page re-initializes Link with the
stored token + `receivedRedirectUri`, finishes the exchange, syncs balances,
applies them, and returns to the app. Non-OAuth banks never leave the popup and
complete inline in `PlaidPanel` — `PLAID_REDIRECT_URI` is harmless for them.

## How it fits together

| Piece | File |
| --- | --- |
| Plaid client (link token, exchange, balances) | `src/lib/integrations/plaid/client.ts` |
| Normalize + match-by-mask + apply | `src/lib/integrations/plaid/map.ts` |
| Connection + last-sync persistence | `src/lib/integrations/store.ts` |
| `POST /api/plaid/link-token` | mint a Link token |
| `POST /api/plaid/exchange` | public token → stored access token |
| `GET /api/plaid/status` | connection + last-sync summary (no tokens) |
| `POST /api/sync/bank` (UI) · `GET` (cron) | pull balances, store snapshot |
| `GET /api/bank/data` | last snapshot for the client to apply |
| Connect + sync UI | `src/components/PlaidPanel.tsx` |
| OAuth redirect landing | `src/app/plaid-oauth/page.tsx` |

Tokens never reach the browser: Link hands the client a one-time *public* token,
which the server exchanges for the durable access token and stores. The
`/data` and `/status` routes never return tokens.

## Security notes

- Access tokens live in `plaid_connection` (RLS on, service-role only) or the
  local `.data/` file in dev. This is bank-connected data — see the pending
  hardening in the project's security cleanup before go-live.
- `POST /api/sync/bank` is behind the app's auth gate; the `GET` variant is for
  Vercel Cron and requires the `CRON_SECRET` bearer.
- To schedule nightly balance refreshes, add `/api/sync/bank` to the cron list
  in `vercel.json` (alongside the QBO/Bill.com jobs).
