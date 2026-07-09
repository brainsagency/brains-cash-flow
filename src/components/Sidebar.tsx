"use client";

import { useState, type ReactNode } from "react";

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
  { key: "invoices", label: "Invoices Due (AR)", title: "Invoices Due", eyebrow: "Accounts Receivable", icon: <IconInvoice /> },
  { key: "bills", label: "Bills to Pay (AP)", title: "Bills to Pay (AP)", eyebrow: "Payables", icon: <IconBill /> },
  { key: "opex", label: "Operating Expenses", title: "Operating Expenses", eyebrow: "Recurring costs", icon: <IconRepeat /> },
  { key: "staff", label: "Staff Roster", title: "Staff Roster", eyebrow: "Payroll", icon: <IconPeople /> },
  { key: "scenarios", label: "Scenarios", title: "Scenario planning", eyebrow: "What-ifs", icon: <IconLayers /> },
  { key: "insights", label: "Insights", title: "Insights", eyebrow: "Analysis", icon: <IconPie /> },
  { key: "assumptions", label: "Assumptions", title: "Assumptions & settings", eyebrow: "Configuration", icon: <IconGear /> },
];

export function Sidebar({ active, onSelect }: { active: ViewKey; onSelect: (v: ViewKey) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        {collapsed ? (
          <button
            className="brand-toggle"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <BrainsMark />
          </button>
        ) : (
          <>
            <BrainsWordmark />
            <button
              className="collapse-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <IconChevron dir="left" />
            </button>
          </>
        )}
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${active === item.key ? "active" : ""}`}
            onClick={() => onSelect(item.key)}
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">GD</span>
        {!collapsed && (
          <>
            <span className="fname">Gustavo Delgado</span>
            <div className="spacer" />
            <a className="btn sm ghost" href="/api/auth/logout" title="Lock / sign out">🔒</a>
          </>
        )}
      </div>
    </aside>
  );
}

function IconChevron({ dir }: { dir: "left" | "right" }) {
  return svg(dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />);
}

const B_PATH =
  "M226.6,273.7c38.5-20.6,58.8-61.2,58.8-115.2c0-106.7-47.1-150.2-162.7-150.2H0.5v564.1h122.9c87.2,0,168-19.6,168-161.5C291.4,342.8,269,292.8,226.6,273.7z M110.6,233.7V113.3H134c17.2,0,36.9,6.1,36.9,53.6c0,45-11.9,66.9-39.9,66.9L110.6,233.7L110.6,233.7z M175.4,402.8c0,46.2-10.2,64.7-37.6,64.7h-27.1V335.6H134C163.4,335.6,175.4,355.1,175.4,402.8L175.4,402.8z";

function BrainsWordmark() {
  return (
    <svg className="wordmark" viewBox="0 0 1755 577" fill="currentColor" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Brains">
      <path d="M616.3,161.5c0-107.4-44.6-153.2-149.1-153.2H333.1v564.1h110.7V362.7h23l45.2,209.8h121.5l-70.4-280.2C597.4,267.9,616.3,220.7,616.3,161.5z M499.6,177.2c0,57.1-10.6,75.5-43.7,75.5h-12.1v-147h12.1C472.3,105.7,499.6,107.1,499.6,177.2z" />
      <path d="M873.9,8.3h-144l-79.3,561.4l-0.4,2.6h107l13.6-121.5h67.5l15.1,121.5h106.2L874.2,10.3L873.9,8.3z M827.3,354.3h-46.2l19.9-214.6h4.2L827.3,354.3z" />
      <path d="M1101.4,8.3H986.9v564.1h114.5V8.3z" />
      <path d="M1337.2,249.5L1255.8,9.9l-0.5-1.6h-107.8v564.1h96.4V282.3l100,290.1h91.3V8.3h-97.9V249.5z" />
      <path d="M1655.9,240.6c-36.8-37.2-68.5-70.7-68.5-114.5c0-13.1,4.3-28.7,24.8-28.7c29.8,0,32.7,32.4,34.6,56.7l2.1,25.1l100.6-7.5l-1.9-27.1C1742.1,77,1721.2,0,1610.7,0c-82.5,0-131.8,50.5-131.8,135.1c0,84.6,50.2,144.8,94.5,191c36.6,38.1,68.2,71.1,68.2,116.5c0,24-10.4,37.7-28.6,37.7c-24.4,0-29.8-15.4-33.3-45.6c-0.2-1.9-1.2-11.7-1.8-20.8c-0.6-9.1-1.9-26.1-1.9-26.1l-104.3,7.9l1.3,34.7h0c7.3,103.5,47.5,145.8,138.4,145.8s143.1-54.1,143.1-141.1S1702.1,287.4,1655.9,240.6L1655.9,240.6z" />
      <path d={B_PATH} />
    </svg>
  );
}

function BrainsMark() {
  return (
    <svg className="mark" viewBox="0 0 1224 1224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Brains">
      <circle cx="612" cy="612" r="612" fill="#131313" />
      <g transform="translate(451.4,292.6) scale(1.1)" fill="#F9F7E9">
        <path d={B_PATH} />
      </g>
    </svg>
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
