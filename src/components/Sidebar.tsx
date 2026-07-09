"use client";

import type { ReactNode } from "react";

export type ViewKey =
  | "cashflow"
  | "invoices"
  | "bills"
  | "opex"
  | "staff"
  | "scenarios"
  | "insights"
  | "assumptions";

export const NAV: Array<{ key: ViewKey; label: string; title: string; eyebrow: string; icon: ReactNode }> = [
  { key: "cashflow", label: "Cash Flow", title: "Cash Flow", eyebrow: "Overview", icon: <IconChart /> },
  { key: "invoices", label: "Invoices Due (AR)", title: "Invoices Due (AR)", eyebrow: "Receivables", icon: <IconInvoice /> },
  { key: "bills", label: "Bills to Pay (AP)", title: "Bills to Pay (AP)", eyebrow: "Payables", icon: <IconBill /> },
  { key: "opex", label: "Operating Expenses", title: "Operating Expenses", eyebrow: "Recurring costs", icon: <IconRepeat /> },
  { key: "staff", label: "Staff Roster", title: "Staff Roster", eyebrow: "Payroll", icon: <IconPeople /> },
  { key: "scenarios", label: "Scenarios", title: "Scenario planning", eyebrow: "What-ifs", icon: <IconLayers /> },
  { key: "insights", label: "Insights", title: "Insights", eyebrow: "Analysis", icon: <IconPie /> },
  { key: "assumptions", label: "Assumptions", title: "Assumptions & settings", eyebrow: "Configuration", icon: <IconGear /> },
];

export function Sidebar({ active, onSelect }: { active: ViewKey; onSelect: (v: ViewKey) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo">B</span>
        Brains
      </div>
      <div className="company">
        <span className="sq">🏢</span>
        Brains Agency
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${active === item.key ? "active" : ""}`}
            onClick={() => onSelect(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">GD</span>
        <span>Gustavo Delgado</span>
        <div className="spacer" />
        <a className="btn sm ghost" href="/api/auth/logout" title="Lock / sign out">🔒</a>
      </div>
    </aside>
  );
}

/* ---- minimal stroke icons (18px, currentColor) ---- */
function svg(children: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconChart() {
  return svg(
    <>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 3 4-6" />
    </>,
  );
}
function IconInvoice() {
  return svg(
    <>
      <path d="M6 2h9l3 3v17H6z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>,
  );
}
function IconBill() {
  return svg(
    <>
      <path d="M4 3h16v18l-3-2-3 2-3-2-3 2z" />
      <path d="M8 8h8M8 12h5" />
    </>,
  );
}
function IconRepeat() {
  return svg(
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>,
  );
}
function IconPeople() {
  return svg(
    <>
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13A4 4 0 0 1 16 11" />
    </>,
  );
}
function IconLayers() {
  return svg(
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>,
  );
}
function IconPie() {
  return svg(
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M12 3v9h9" />
    </>,
  );
}
function IconGear() {
  return svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" />
    </>,
  );
}
