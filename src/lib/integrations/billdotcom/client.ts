/**
 * BILL (Bill.com) v3 API client — AP source of truth.
 *
 * Auth is session-based (not OAuth): POST /v3/login with devKey + org creds
 * returns a sessionId, passed as a header on every subsequent call. Sessions
 * expire after ~35 min idle, so we log in fresh on each sync rather than
 * persisting the session.
 *
 * Docs: https://developer.bill.com/docs/bill-v3-api-get-started
 */

export type BillEnvironment = "sandbox" | "production";

export interface BillConfig {
  devKey: string;
  organizationId: string;
  username: string;
  password: string;
  environment: BillEnvironment;
}

export interface BillDotComBill {
  id: string;
  amount?: number;
  dueDate?: string; // yyyy-MM-dd
  invoiceNumber?: string;
  vendorId?: string;
  approvalStatus?: string; // e.g. UNASSIGNED, ASSIGNED, APPROVED
  paymentStatus?: string; // e.g. UNPAID, PARTIALLYPAID, SCHEDULED, PAID
}

export function billConfig(): BillConfig {
  const devKey = process.env.BILLDOTCOM_DEV_KEY;
  const organizationId = process.env.BILLDOTCOM_ORG_ID;
  const username = process.env.BILLDOTCOM_USERNAME;
  const password = process.env.BILLDOTCOM_PASSWORD;
  const environment = (process.env.BILLDOTCOM_ENVIRONMENT ?? "sandbox") as BillEnvironment;
  const missing = [
    ["BILLDOTCOM_DEV_KEY", devKey],
    ["BILLDOTCOM_ORG_ID", organizationId],
    ["BILLDOTCOM_USERNAME", username],
    ["BILLDOTCOM_PASSWORD", password],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Bill.com is not configured. Missing env: ${missing.join(", ")}`);
  }
  return { devKey: devKey!, organizationId: organizationId!, username: username!, password: password!, environment };
}

export function billBase(environment: BillEnvironment): string {
  return environment === "production"
    ? "https://gateway.prod.bill.com/connect"
    : "https://gateway.stage.bill.com/connect";
}

/** Sign in and return a sessionId for subsequent calls. */
export async function login(cfg: BillConfig): Promise<string> {
  const res = await fetch(`${billBase(cfg.environment)}/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: cfg.username,
      password: cfg.password,
      organizationId: cfg.organizationId,
      devKey: cfg.devKey,
    }),
  });
  if (!res.ok) throw new Error(`Bill.com login failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { sessionId?: string };
  if (!json.sessionId) throw new Error("Bill.com login: no sessionId in response");
  return json.sessionId;
}

interface ListResponse<T> {
  results?: T[];
  nextPage?: string | null;
}

async function getPaged<T>(cfg: BillConfig, sessionId: string, path: string): Promise<T[]> {
  const base = billBase(cfg.environment);
  const out: T[] = [];
  let page: string | null = null;
  for (let i = 0; i < 50; i++) {
    // safety cap: 50 pages
    const url = new URL(`${base}${path}`);
    url.searchParams.set("max", "100");
    if (page) url.searchParams.set("page", page);
    const res = await fetch(url.toString(), {
      headers: { sessionId, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Bill.com GET ${path} failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as ListResponse<T>;
    out.push(...(json.results ?? []));
    if (!json.nextPage) break;
    page = json.nextPage;
  }
  return out;
}

export function listBills(cfg: BillConfig, sessionId: string): Promise<BillDotComBill[]> {
  return getPaged<BillDotComBill>(cfg, sessionId, "/v3/bills");
}

interface BillVendor {
  id: string;
  name?: string;
}

/** Map vendorId → vendor name for nicer ledger labels. */
export async function listVendorNames(cfg: BillConfig, sessionId: string): Promise<Record<string, string>> {
  const vendors = await getPaged<BillVendor>(cfg, sessionId, "/v3/vendors");
  const map: Record<string, string> = {};
  for (const v of vendors) if (v.name) map[v.id] = v.name;
  return map;
}
