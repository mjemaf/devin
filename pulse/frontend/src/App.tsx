import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { AgentReview } from "./pages/AgentReview";
import { AuditPage } from "./pages/AuditPage";
import { Cases } from "./pages/Cases";
import { Dashboard } from "./pages/Dashboard";
import { Merchant360Page } from "./pages/Merchant360Page";
import { Merchants } from "./pages/Merchants";
import { PolicyQA } from "./pages/PolicyQA";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/merchants", label: "Merchants" },
  { to: "/cases", label: "Cases & alerts" },
  { to: "/agents", label: "Agent review" },
  { to: "/policy", label: "Policy Q&A" },
  { to: "/audit", label: "Audit" },
];

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div>
            <div className="brand-name">Pulse</div>
            <div className="brand-sub">Risk &amp; compliance</div>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Synthetic reference implementation</div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/merchants" element={<Merchants />} />
          <Route path="/merchants/:entityId" element={<Merchant360Page />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/agents" element={<AgentReview />} />
          <Route path="/policy" element={<PolicyQA />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
