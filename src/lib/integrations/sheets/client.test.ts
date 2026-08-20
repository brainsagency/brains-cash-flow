import { generateKeyPairSync, createVerify } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SheetsAuthError,
  getAccessToken,
  getTabValues,
  listTabs,
  resolveTab,
  sheetsConfigFromEnv,
} from "./client.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const cfg = {
  clientEmail: "cashflow@brains-project.iam.gserviceaccount.com",
  privateKey: privateKey as string,
  spreadsheetId: "sheet-123",
};

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

/** Stub fetch, returning `body` with `status`, and record what was sent. */
function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sheetsConfigFromEnv", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    delete process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    delete process.env.PROJECTIONS_SHEET_ID;
    delete process.env.PROJECTIONS_SHEET_TAB;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null when the integration is not set up", () => {
    expect(sheetsConfigFromEnv()).toBeNull();
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "a@b.com";
    expect(sheetsConfigFromEnv()).toBeNull(); // still missing key + sheet id
  });

  it("unescapes the \\n-encoded PEM that Vercel env vars store", () => {
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "a@b.com";
    process.env.GOOGLE_SHEETS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
    process.env.PROJECTIONS_SHEET_ID = "xyz";
    const parsed = sheetsConfigFromEnv()!;
    expect(parsed.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
    expect(parsed.tabTitle).toBeUndefined();
  });
});

describe("getAccessToken", () => {
  it("sends a correctly signed RS256 JWT bearer assertion", async () => {
    const calls = stubFetch(200, { access_token: "ya29.token" });
    const token = await getAccessToken(cfg);
    expect(token).toBe("ya29.token");

    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = body.get("assertion")!.split(".");
    expect(decodeSegment(header!)).toEqual({ alg: "RS256", typ: "JWT" });

    const parsed = decodeSegment(claims!) as Record<string, string | number>;
    expect(parsed.iss).toBe(cfg.clientEmail);
    expect(parsed.scope).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(parsed.aud).toBe("https://oauth2.googleapis.com/token");
    expect(Number(parsed.exp) - Number(parsed.iat)).toBe(3600);

    // The signature must actually verify against the public key — a
    // base64url slip here would only ever surface as a 400 from Google.
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    const raw = Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(verifier.verify(publicKey as string, raw)).toBe(true);
  });

  it("asks for read-only scope, never write", async () => {
    const calls = stubFetch(200, { access_token: "t" });
    await getAccessToken(cfg);
    const assertion = new URLSearchParams(calls[0]!.init!.body as string).get("assertion")!;
    expect(String(decodeSegment(assertion.split(".")[1]!).scope)).toMatch(/\.readonly$/);
  });

  it("names the private key when the PEM is mangled", async () => {
    stubFetch(200, { access_token: "t" });
    await expect(getAccessToken({ ...cfg, privateKey: "not-a-pem" })).rejects.toThrow(SheetsAuthError);
    await expect(getAccessToken({ ...cfg, privateKey: "not-a-pem" })).rejects.toThrow(
      /GOOGLE_SHEETS_PRIVATE_KEY/,
    );
  });

  it("raises an auth error when Google rejects the assertion", async () => {
    stubFetch(400, { error: "invalid_grant" });
    await expect(getAccessToken(cfg)).rejects.toThrow(SheetsAuthError);
  });
});

describe("API calls", () => {
  it("lists tab titles", async () => {
    stubFetch(200, {
      sheets: [
        { properties: { title: "2026", sheetId: 1 } },
        { properties: { title: "2025", sheetId: 2 } },
        { properties: {} }, // untitled tabs are dropped
      ],
    });
    expect(await listTabs(cfg, "t")).toEqual([
      { title: "2026", sheetId: 1 },
      { title: "2025", sheetId: 2 },
    ]);
  });

  it("tells the user who to share the sheet with on a 403", async () => {
    stubFetch(403, { error: "forbidden" });
    await expect(listTabs(cfg, "t")).rejects.toThrow(SheetsAuthError);
    await expect(listTabs(cfg, "t")).rejects.toThrow(cfg.clientEmail);
  });

  it("points at the config var on a 404", async () => {
    stubFetch(404, {});
    await expect(listTabs(cfg, "t")).rejects.toThrow(/PROJECTIONS_SHEET_ID/);
  });

  it("requests unformatted values so money arrives as numbers", async () => {
    const calls = stubFetch(200, { values: [[1, 2]] });
    expect(await getTabValues(cfg, "t", "2026")).toEqual([[1, 2]]);
    expect(calls[0]!.url).toContain("valueRenderOption=UNFORMATTED_VALUE");
  });

  it("quotes tab titles containing spaces and apostrophes", async () => {
    const calls = stubFetch(200, { values: [] });
    await getTabValues(cfg, "t", "Ben's 2026 Plan");
    expect(decodeURIComponent(calls[0]!.url)).toContain("/values/'Ben''s 2026 Plan'");
  });

  it("returns an empty grid for a blank tab rather than throwing", async () => {
    stubFetch(200, {});
    expect(await getTabValues(cfg, "t", "2026")).toEqual([]);
  });
});

describe("resolveTab", () => {
  const tabs = [
    { title: "Notes", sheetId: 0 },
    { title: "2025", sheetId: 1 },
    { title: "2026", sheetId: 2 },
  ];

  it("prefers the configured tab", () => {
    expect(resolveTab(tabs, "2025", 2026)?.title).toBe("2025");
  });

  it("matches a configured tab case- and whitespace-insensitively", () => {
    const named = [{ title: "Revenue Forecast", sheetId: 0 }];
    expect(resolveTab(named, " revenue forecast ", 2026)?.title).toBe("Revenue Forecast");
  });

  it("falls back to the tab named for the year", () => {
    expect(resolveTab(tabs, undefined, 2026)?.title).toBe("2026");
    expect(resolveTab(tabs, "Missing Tab", 2025)?.title).toBe("2025");
  });

  it("falls back to the first tab when no year matches", () => {
    expect(resolveTab(tabs, undefined, 2030)?.title).toBe("Notes");
  });

  it("returns null for an empty workbook", () => {
    expect(resolveTab([], undefined, 2026)).toBeNull();
  });
});
