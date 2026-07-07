import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Brains Cash Flow",
};

const EFFECTIVE = "July 7, 2026";

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy Policy</h1>
      <p className="muted">Effective {EFFECTIVE}</p>

      <p>
        Brains Cash Flow (the &ldquo;Application&rdquo;) is an internal financial planning tool operated by Brains on
        Fire (&ldquo;Brains&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy describes what data the Application
        handles and how it is used.
      </p>

      <h2>1. Data we collect</h2>
      <p>
        With authorization, the Application retrieves business accounting data on a <b>read-only</b> basis from
        connected services, including QuickBooks Online (accounts receivable, invoices, bills) and BILL (accounts
        payable). Authorized users may also enter planning inputs manually (e.g. budgets, scheduled withdrawals,
        scenarios). The Application does not collect consumer personal information, and it does not initiate payments
        or transactions.
      </p>

      <h2>2. How data is used</h2>
      <p>
        Data is used solely to produce internal cash-flow forecasts, scenario models, and related reporting for Brains.
        We do not sell data, use it for advertising, or share it with third parties except the service providers below.
      </p>

      <h2>3. Storage and service providers</h2>
      <p>
        Data and encrypted access tokens are stored with our infrastructure providers (Vercel for hosting, Supabase for
        the database), access-controlled and used only to operate the Application. OAuth tokens for connected services
        can be revoked at any time from the source system (e.g. the QuickBooks connected-apps settings), which
        immediately ends the Application&rsquo;s access.
      </p>

      <h2>4. Security</h2>
      <p>
        Access to the Application is restricted to authorized Brains personnel. Connections to third-party services use
        OAuth 2.0 or session-based API authentication over HTTPS; credentials are stored server-side and never exposed
        to the browser.
      </p>

      <h2>5. Data retention and deletion</h2>
      <p>
        Synced financial data is retained only as needed for forecasting and reconciliation. To request deletion of
        stored data or disconnection of a linked service, contact us and we will remove it promptly.
      </p>

      <h2>6. Changes</h2>
      <p>We may update this policy; the effective date above reflects the latest revision.</p>

      <h2>7. Contact</h2>
      <p>
        Privacy questions: <a href="mailto:gustavo@brainsonfire.com">gustavo@brainsonfire.com</a>.
      </p>
    </main>
  );
}
