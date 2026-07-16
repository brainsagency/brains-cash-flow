"use client";

import { useEffect, useRef, useState } from "react";
import { type BankAccount, type ForecastInput } from "@engine/index.js";
import { useStore } from "@/lib/data/store.js";
import { daysAgo, fmtShortDate, todayISO } from "@/lib/format.js";
import { MoneyInput } from "@/components/fields.js";
import { PlaidPanel } from "@/components/PlaidPanel.js";

/**
 * Assumptions & settings — deliberately lean. Everything with a dedicated tab
 * lives there now (AR → Invoices, AP → Bills, payroll → Staff Roster, opex &
 * AmEx → Operating Expenses, manual cash-outs → Other Withdrawals, deals →
 * New Business). What remains here is what has no other home: the forecast
 * anchor, burn/reserve/runway thresholds, and the manually-entered bank
 * balances that seed the whole projection.
 */
export function AssumptionsPanel() {
  const { input, setInput, storageMode } = useStore();
  const patch = (p: Partial<ForecastInput>) => setInput((prev) => ({ ...prev, ...p }));

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, textTransform: "none", fontSize: 16, color: "var(--text)" }}>Assumptions &amp; settings</h2>
        <div className="spacer" />
        <span className={`chip ${storageMode === "cloud" ? "committed" : "budgeted"}`}>
          {storageMode === "cloud" ? "shared workspace" : "this browser only"}
        </span>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Global forecast settings and bank balances. Everything else — invoices, bills, payroll, expenses, and new
        business — is edited on its own tab.
      </div>

      {storageMode === "local" && (
        <div className="alert warning" style={{ marginBottom: 14 }}>
          <span className="ico">🟡</span>
          <span>
            Changes save to <b>this browser only</b>. Run the <code>app_state</code> table SQL in Supabase to enable
            the shared cloud workspace.
          </span>
        </div>
      )}

      <Settings anchorDate={input.anchorDate} onPatch={patch} />
      <BankAccounts />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Settings({ anchorDate, onPatch }: { anchorDate: string; onPatch: (p: Partial<ForecastInput>) => void }) {
  const { input, setInput } = useStore();
  const s = input.settings ?? { reserveMultiple: 3, runwayAlertMonths: 6, largeOverdueARThreshold: 50_000 };
  const set = (p: Partial<typeof s>) => setInput((prev) => ({ ...prev, settings: { ...s, ...p } }));

  return (
    <Group title="Forecast settings">
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ width: 150 }}>
          <label>Anchor date (&ldquo;today&rdquo;)</label>
          <input type="date" value={anchorDate} onChange={(e) => e.target.value && onPatch({ anchorDate: e.target.value })} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>Monthly burn override</label>
          <input
            type="number"
            value={s.monthlyBurnOverride ?? ""}
            placeholder="auto (computed)"
            onChange={(e) => set({ monthlyBurnOverride: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Reserve multiple</label>
          <input type="number" value={s.reserveMultiple} onChange={(e) => set({ reserveMultiple: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>Runway alert (months)</label>
          <input type="number" value={s.runwayAlertMonths} onChange={(e) => set({ runwayAlertMonths: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ width: 190 }}>
          <label>AR collection lag (days)</label>
          <input
            type="number"
            min={0}
            value={input.arCollectionLagDays ?? 0}
            onChange={(e) => onPatch({ arCollectionLagDays: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Collection lag shifts not-yet-due invoices this many days past their due date — clients rarely pay on time.
        Already-overdue invoices are assumed collected this week (not delayed further). Per-invoice date overrides
        (set on the Invoices tab) still win. 0 = assume paid on the due date.
      </div>
    </Group>
  );
}

const STALE_BALANCE_DAYS = 10;

/**
 * Which tracked accounts are backed by Plaid: an account is "linked" when its
 * last-four matches an account in the latest bank-sync snapshot. Re-checks when
 * balances change (i.e. after a sync) so a freshly-connected account lights up
 * without a reload. Read-only — never returns tokens.
 */
function usePlaidLinkedMasks(refreshKey: string): { connected: boolean; syncedMasks: Set<string> } {
  const [connected, setConnected] = useState(false);
  const [syncedMasks, setSyncedMasks] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = (await (await fetch("/api/plaid/status", { cache: "no-store" })).json()) as {
          connected?: boolean;
        };
        const data = (await (await fetch("/api/bank/data", { cache: "no-store" })).json()) as {
          accounts?: { mask: string | null }[];
        };
        if (cancelled) return;
        setConnected(Boolean(status.connected));
        setSyncedMasks(
          new Set((data.accounts ?? []).map((a) => a.mask).filter((m): m is string => Boolean(m))),
        );
      } catch {
        /* endpoint unavailable — treat as not linked */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return { connected, syncedMasks };
}

function BankAccounts() {
  const { input, setInput } = useStore();
  const update = (id: string, p: Partial<(typeof input.bankAccounts)[number]>) =>
    setInput((prev) => ({
      ...prev,
      bankAccounts: prev.bankAccounts.map((a) => (a.id === id ? { ...a, ...p } : a)),
    }));
  // Editing a balance stamps it as updated today.
  const setBalance = (id: string, value: number) => update(id, { beginningBalance: value, balanceAsOf: todayISO() });
  // Confirm the balance is still current without changing the amount — refresh
  // the as-of date to today (e.g. a savings account that hasn't moved in weeks).
  const markReviewed = (id: string) => update(id, { balanceAsOf: todayISO() });

  // Signature changes whenever a balance/date moves (e.g. a sync), refreshing
  // the linked-account badges.
  const refreshKey = input.bankAccounts
    .map((a) => `${a.id}:${a.mask ?? ""}:${a.balanceAsOf ?? ""}:${a.beginningBalance}`)
    .join("|");
  const { connected, syncedMasks } = usePlaidLinkedMasks(refreshKey);
  const linkedCount = input.bankAccounts.filter((a) => a.mask && syncedMasks.has(a.mask)).length;

  return (
    <Group title="Bank accounts (which count toward operating cash)">
      {connected && (
        <div className="row" style={{ marginBottom: 8, gap: 6 }}>
          <span className="chip plaid">🔗 Plaid connected</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {linkedCount > 0
              ? `${linkedCount} ${linkedCount === 1 ? "account" : "accounts"} auto-updating by last-four.`
              : "Set an account's last-four to auto-update it from Plaid."}
          </span>
        </div>
      )}
      {input.bankAccounts.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          linked={Boolean(a.mask && syncedMasks.has(a.mask))}
          onUpdate={update}
          onSetBalance={setBalance}
          onConfirm={markReviewed}
        />
      ))}
      <div className="muted" style={{ marginTop: 8 }}>
        Editing a balance stamps it as updated today. If a balance hasn&apos;t moved (a savings account can sit for
        weeks), hit <b>Confirm</b> to refresh the as-of date without changing the amount. Balances older than{" "}
        {STALE_BALANCE_DAYS} days are flagged. A <span className="chip plaid" style={{ fontSize: 10 }}>🔗 Plaid</span>{" "}
        balance updates automatically on sync.
      </div>
      <PlaidPanel />
    </Group>
  );
}

function AccountRow({
  account: a,
  linked,
  onUpdate,
  onSetBalance,
  onConfirm,
}: {
  account: BankAccount;
  linked: boolean;
  onUpdate: (id: string, p: Partial<BankAccount>) => void;
  onSetBalance: (id: string, value: number) => void;
  onConfirm: (id: string) => void;
}) {
  const age = a.balanceAsOf ? daysAgo(a.balanceAsOf) : null;
  const stale = age !== null && age >= STALE_BALANCE_DAYS;

  // Flash the balance when it changes on a linked account — i.e. a Plaid sync
  // just wrote a fresh number. (Manual accounts don't flash, so typing into
  // them doesn't strobe.)
  const sig = `${a.beginningBalance}:${a.balanceAsOf ?? ""}`;
  const prev = useRef(sig);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === sig) return;
    prev.current = sig;
    if (!linked) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1300);
    return () => clearTimeout(t);
  }, [sig, linked]);

  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <input
        type="text"
        value={a.name}
        placeholder="Nickname"
        aria-label="Account nickname"
        onChange={(e) => onUpdate(a.id, { name: e.target.value })}
        style={{ width: 130 }}
      />
      <div className="row" style={{ gap: 3, alignItems: "center" }}>
        <span className="muted">…</span>
        <input
          type="text"
          inputMode="numeric"
          value={a.mask ?? ""}
          placeholder="1234"
          aria-label="Last four digits"
          maxLength={4}
          onChange={(e) => onUpdate(a.id, { mask: e.target.value.replace(/\D/g, "").slice(0, 4) || undefined })}
          style={{ width: 52 }}
        />
      </div>
      <div className={flash ? "balance-flash" : undefined} style={{ width: 150 }}>
        <MoneyInput value={a.beginningBalance} step="0.01" onChange={(n) => onSetBalance(a.id, n)} />
      </div>
      <label className="toggle">
        <input type="checkbox" checked={a.operating !== false} onChange={(e) => onUpdate(a.id, { operating: e.target.checked })} />
        operating
      </label>
      {linked && <span className="chip plaid" title="Balance auto-updated from Plaid">🔗 Plaid</span>}
      <span className={`chip ${stale ? "danger" : linked ? "committed" : "neutral"}`} style={{ marginLeft: 4 }}>
        {a.balanceAsOf ? `as of ${fmtShortDate(a.balanceAsOf)}${stale ? ` · ${age}d old` : ""}` : "no date"}
      </span>
      {linked ? (
        <span className="muted" style={{ fontSize: 11, marginLeft: 2 }} title="Managed by Plaid — no need to confirm manually">
          auto
        </span>
      ) : (
        <button
          className="btn sm ghost"
          onClick={() => onConfirm(a.id)}
          title="Confirm this balance is still current — sets the as-of date to today without changing the amount"
        >
          Confirm
        </button>
      )}
    </div>
  );
}
