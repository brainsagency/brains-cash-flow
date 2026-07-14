-- Brains Cash Flow — Supabase schema (run in the Supabase SQL editor).
-- Holds the QuickBooks connection, last sync, and a sync log.
-- RLS is ON with no policies: only the service_role key (used server-side)
-- can read/write these. The browser never touches them directly.

-- QuickBooks OAuth connection (single row).
create table if not exists public.qbo_connection (
  id text primary key default 'default',
  realm_id text not null,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at bigint not null, -- epoch ms
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Last successful sync (single row). AR feeds the forecast; AP is validation.
create table if not exists public.qbo_last_sync (
  id text primary key default 'default',
  synced_at timestamptz not null,
  anchor date not null,
  ar_events jsonb not null default '[]',
  ap_validation_events jsonb not null default '[]',
  ar_total numeric not null default 0,
  ap_total numeric not null default 0
);

-- Last successful Bill.com sync (single row). AP source of truth for the
-- forecast; `reconciliation` holds the check vs QuickBooks Bills.
create table if not exists public.bill_last_sync (
  id text primary key default 'default',
  synced_at timestamptz not null,
  anchor date not null,
  ap_events jsonb not null default '[]',
  ap_total numeric not null default 0,
  reconciliation jsonb
);

-- Plaid connection (single row): the durable access token for the linked
-- bank item. Server-only, like the QBO tokens.
create table if not exists public.plaid_connection (
  id text primary key default 'default',
  access_token text not null,
  item_id text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Last successful bank-balance sync (single row). `accounts` is the normalized
-- balance snapshot; the client applies it to tracked accounts by last-four.
create table if not exists public.bank_last_sync (
  id text primary key default 'default',
  synced_at timestamptz not null,
  accounts jsonb not null default '[]'
);

-- Shared app workspace (single document): the manual forecast layer,
-- scenarios, and per-bill AP adjustments — so the whole team sees the same
-- assumptions instead of per-browser localStorage. Last write wins.
create table if not exists public.app_state (
  id text primary key default 'default',
  input jsonb not null,
  scenarios jsonb not null default '[]',
  ap_adjustments jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Sync run log (append-only-ish; UI shows freshness/errors).
create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  source text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null,
  message text,
  ar_count int,
  ap_count int,
  account_count int,
  created_at timestamptz not null default now()
);

alter table public.qbo_connection enable row level security;
alter table public.qbo_last_sync enable row level security;
alter table public.bill_last_sync enable row level security;
alter table public.plaid_connection enable row level security;
alter table public.bank_last_sync enable row level security;
alter table public.app_state enable row level security;
alter table public.sync_log enable row level security;
