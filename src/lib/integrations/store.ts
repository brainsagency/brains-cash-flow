/**
 * Integration store — persists the QuickBooks connection, last sync, and log.
 *
 * Two backends behind one interface:
 *  - Supabase (when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 *    set) — the production/Vercel path.
 *  - Local JSON file under `.data/` — dev fallback when Supabase isn't
 *    configured yet (Vercel's filesystem is ephemeral, so file store is
 *    localhost-only).
 *
 * Server-only. Do not import from client components.
 */

import { promises as fs } from "fs";
import path from "path";
import type { CashEvent } from "@engine/index.js";
import type { ApReconciliation } from "./billdotcom/reconcile.js";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase.js";

export interface QboConnection {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number; // epoch ms
  connectedAt: string;
}

export interface QboSyncResult {
  syncedAt: string;
  anchor: string;
  arEvents: CashEvent[];
  apValidationEvents: CashEvent[];
  arTotal: number;
  apTotal: number;
}

export interface BillSyncResult {
  syncedAt: string;
  anchor: string;
  apEvents: CashEvent[]; // feeds the forecast (AP source of truth)
  apTotal: number;
  reconciliation: ApReconciliation | null; // vs QBO Bills
}

export interface SyncLogEntry {
  source: "qbo" | "billdotcom";
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error";
  message?: string;
  arCount?: number;
  apCount?: number;
}

// ---------------------------------------------------------------------------
// Public API (dispatches to the active backend)
// ---------------------------------------------------------------------------

export function saveConnection(c: QboConnection): Promise<void> {
  return isSupabaseConfigured() ? sbSaveConnection(c) : fileSaveConnection(c);
}
export function getConnection(): Promise<QboConnection | null> {
  return isSupabaseConfigured() ? sbGetConnection() : fileGetConnection();
}
export function saveSync(r: QboSyncResult): Promise<void> {
  return isSupabaseConfigured() ? sbSaveSync(r) : fileSaveSync(r);
}
export function getLastSync(): Promise<QboSyncResult | null> {
  return isSupabaseConfigured() ? sbGetLastSync() : fileGetLastSync();
}
export function appendLog(e: SyncLogEntry): Promise<void> {
  return isSupabaseConfigured() ? sbAppendLog(e) : fileAppendLog(e);
}
export function saveBillSync(r: BillSyncResult): Promise<void> {
  return isSupabaseConfigured() ? sbSaveBillSync(r) : fileSaveBillSync(r);
}
export function getLastBillSync(): Promise<BillSyncResult | null> {
  return isSupabaseConfigured() ? sbGetLastBillSync() : fileGetLastBillSync();
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

async function sbSaveConnection(c: QboConnection): Promise<void> {
  const { error } = await supabaseAdmin().from("qbo_connection").upsert({
    id: "default",
    realm_id: c.realmId,
    access_token: c.accessToken,
    refresh_token: c.refreshToken,
    access_token_expires_at: c.accessTokenExpiresAt,
    connected_at: c.connectedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase saveConnection: ${error.message}`);
}

async function sbGetConnection(): Promise<QboConnection | null> {
  const { data, error } = await supabaseAdmin()
    .from("qbo_connection")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(`Supabase getConnection: ${error.message}`);
  if (!data) return null;
  return {
    realmId: data.realm_id as string,
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    accessTokenExpiresAt: Number(data.access_token_expires_at),
    connectedAt: data.connected_at as string,
  };
}

async function sbSaveSync(r: QboSyncResult): Promise<void> {
  const { error } = await supabaseAdmin().from("qbo_last_sync").upsert({
    id: "default",
    synced_at: r.syncedAt,
    anchor: r.anchor,
    ar_events: r.arEvents,
    ap_validation_events: r.apValidationEvents,
    ar_total: r.arTotal,
    ap_total: r.apTotal,
  });
  if (error) throw new Error(`Supabase saveSync: ${error.message}`);
}

async function sbGetLastSync(): Promise<QboSyncResult | null> {
  const { data, error } = await supabaseAdmin()
    .from("qbo_last_sync")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(`Supabase getLastSync: ${error.message}`);
  if (!data) return null;
  return {
    syncedAt: data.synced_at as string,
    anchor: data.anchor as string,
    arEvents: (data.ar_events ?? []) as CashEvent[],
    apValidationEvents: (data.ap_validation_events ?? []) as CashEvent[],
    arTotal: Number(data.ar_total),
    apTotal: Number(data.ap_total),
  };
}

async function sbAppendLog(e: SyncLogEntry): Promise<void> {
  const { error } = await supabaseAdmin().from("sync_log").insert({
    source: e.source,
    started_at: e.startedAt,
    finished_at: e.finishedAt,
    status: e.status,
    message: e.message ?? null,
    ar_count: e.arCount ?? null,
    ap_count: e.apCount ?? null,
  });
  if (error) throw new Error(`Supabase appendLog: ${error.message}`);
}

async function sbSaveBillSync(r: BillSyncResult): Promise<void> {
  const { error } = await supabaseAdmin().from("bill_last_sync").upsert({
    id: "default",
    synced_at: r.syncedAt,
    anchor: r.anchor,
    ap_events: r.apEvents,
    ap_total: r.apTotal,
    reconciliation: r.reconciliation,
  });
  if (error) throw new Error(`Supabase saveBillSync: ${error.message}`);
}

async function sbGetLastBillSync(): Promise<BillSyncResult | null> {
  const { data, error } = await supabaseAdmin()
    .from("bill_last_sync")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(`Supabase getLastBillSync: ${error.message}`);
  if (!data) return null;
  return {
    syncedAt: data.synced_at as string,
    anchor: data.anchor as string,
    apEvents: (data.ap_events ?? []) as CashEvent[],
    apTotal: Number(data.ap_total),
    reconciliation: (data.reconciliation ?? null) as ApReconciliation | null,
  };
}

// ---------------------------------------------------------------------------
// File backend (dev fallback)
// ---------------------------------------------------------------------------

interface FileShape {
  connection?: QboConnection;
  lastSync?: QboSyncResult;
  billLastSync?: BillSyncResult;
  log: SyncLogEntry[];
}

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "qbo.json");

async function fileRead(): Promise<FileShape> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as FileShape;
  } catch {
    return { log: [] };
  }
}
async function fileWrite(data: FileShape): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}
async function fileSaveConnection(connection: QboConnection): Promise<void> {
  await fileWrite({ ...(await fileRead()), connection });
}
async function fileGetConnection(): Promise<QboConnection | null> {
  return (await fileRead()).connection ?? null;
}
async function fileSaveSync(lastSync: QboSyncResult): Promise<void> {
  await fileWrite({ ...(await fileRead()), lastSync });
}
async function fileGetLastSync(): Promise<QboSyncResult | null> {
  return (await fileRead()).lastSync ?? null;
}
async function fileAppendLog(entry: SyncLogEntry): Promise<void> {
  const s = await fileRead();
  await fileWrite({ ...s, log: [entry, ...s.log].slice(0, 50) });
}
async function fileSaveBillSync(billLastSync: BillSyncResult): Promise<void> {
  await fileWrite({ ...(await fileRead()), billLastSync });
}
async function fileGetLastBillSync(): Promise<BillSyncResult | null> {
  return (await fileRead()).billLastSync ?? null;
}
