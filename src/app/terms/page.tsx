import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "End-User License Agreement — Brains Cash Flow",
};

const EFFECTIVE = "July 7, 2026";

export default function Terms() {
  return (
    <main className="legal">
      <h1>End-User License Agreement</h1>
      <p className="muted">Effective {EFFECTIVE}</p>

      <p>
        Brains Cash Flow (the &ldquo;Application&rdquo;) is an internal financial planning tool operated by Brains on
        Fire (&ldquo;Brains&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By accessing the Application you agree to this
        End-User License Agreement (&ldquo;Agreement&rdquo;).
      </p>

      <h2>1. License and permitted use</h2>
      <p>
        The Application is licensed, not sold, solely for internal business use by authorized Brains personnel.
        You may not sublicense, resell, or provide access to the Application to any third party.
      </p>

      <h2>2. Financial data and read-only access</h2>
      <p>
        The Application connects to third-party financial services (including QuickBooks Online and BILL) on a
        <b> read-only</b> basis to retrieve accounting data used for cash-flow forecasting. The Application does not
        initiate payments, transfers, or any financial transactions.
      </p>

      <h2>3. No financial advice; forecasts are estimates</h2>
      <p>
        Outputs of the Application (including forecasts, runway, and scenario projections) are estimates for internal
        planning only. They are not financial, accounting, tax, or legal advice, and should be verified against
        source systems before being relied upon.
      </p>

      <h2>4. Intellectual property</h2>
      <p>
        The Application and its software, design, and content are the property of Brains or its licensors. Third-party
        service names (including QuickBooks and BILL) are trademarks of their respective owners.
      </p>

      <h2>5. Disclaimer of warranty and limitation of liability</h2>
      <p>
        THE APPLICATION IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY
        LAW, BRAINS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM USE
        OF THE APPLICATION.
      </p>

      <h2>6. Termination</h2>
      <p>
        We may suspend or terminate access to the Application at any time. Sections 3–5 survive termination.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about this Agreement: <a href="mailto:gustavo@brainsonfire.com">gustavo@brainsonfire.com</a>.
      </p>
    </main>
  );
}
