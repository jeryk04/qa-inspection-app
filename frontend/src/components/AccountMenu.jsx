import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { ROLE_LABELS } from "../lib/format";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// The role experiences an admin can preview -- null is "Admin" itself (their
// own unrestricted view), so it's listed alongside the other three instead
// of needing separate "switch view" vs. "back to admin" affordances.
const ADMIN_VIEW_OPTIONS = [null, "qc", "operator", "engineer"];
// QC can additionally jump to the Quality Analytics dashboard (its backend
// routes already allow the qc role, see GET /api/inspections/analytics --
// this is just giving QC a way to reach it). null is "QC Inspector" itself,
// same "listed alongside the rest" reasoning as ADMIN_VIEW_OPTIONS above.
const QC_VIEW_OPTIONS = [null, "engineer"];

// Shared by both the admin and QC "View as" sections below -- same button
// list, just a different option set and a different label for the null
// ("back to my own view") entry.
function ViewAsSection({ options, selfRole, viewAs, onSelect }) {
  return (
    <div className="account-menu-section">
      <div className="account-menu-section-label">View as</div>
      {options.map((role) => {
        const active = viewAs === role;
        return (
          <button
            key={role ?? selfRole}
            type="button"
            className={`account-menu-item${active ? " account-menu-item-active" : ""}`}
            aria-current={active}
            onClick={() => onSelect(role)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {active ? <path d="M20 6 9 17l-5-5" /> : null}
            </svg>
            {ROLE_LABELS[role ?? selfRole]}
          </button>
        );
      })}
    </div>
  );
}

function initialsFor(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Header's account/settings menu -- avatar + name trigger a dropdown with
// the account-level actions (switch role view, logout) instead of laying
// each one out as its own header button. The "View as" section renders for
// admin (full ADMIN_VIEW_OPTIONS) and QC (just QC_VIEW_OPTIONS, to reach
// Quality Analytics) -- a no-op for every other role (viewAs/onSelectView
// go unused, see Home.jsx's branching).
export default function AccountMenu({ user, viewAs, onSelectView, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  // Operators only ever do In-Process, reached from their own Home cards --
  // Customers/History/WO# Lookup are QC-oriented company-wide pickers that
  // would just dead-end them, same reasoning App.jsx used when these lived
  // as separate header links.
  const { effectiveRole } = useAuth();
  const isOperatorView = effectiveRole === "operator";
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const closeOnEscape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const initials = initialsFor(user.full_name);
  const isAdmin = user.role === "admin";
  const isQc = user.role === "qc";

  const selectView = (role) => {
    setOpen(false);
    if (viewAs !== role) onSelectView(role);
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="account-avatar">{initials}</span>
        <span className="account-menu-name">{user.full_name}</span>
        <svg
          className="account-menu-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="account-menu-panel">
          <div className="account-menu-header">
            <span className="account-avatar account-avatar-lg">{initials}</span>
            <div>
              <div className="account-menu-fullname">{user.full_name}</div>
              <div className="account-menu-role">{ROLE_LABELS[user.role] ?? user.role}</div>
            </div>
          </div>

          {!isOperatorView && (
            <div className="account-menu-section">
              <div className="account-menu-section-label">Browse</div>
              <Link to="/clients?browse=1" className="account-menu-item" onClick={() => setOpen(false)}>
                Customers
              </Link>
              <Link to="/history" className="account-menu-item" onClick={() => setOpen(false)}>
                History
              </Link>
              <Link to="/wo-lookup" className="account-menu-item" onClick={() => setOpen(false)}>
                WO# Lookup
              </Link>
            </div>
          )}

          {isAdmin && (
            <div className="account-menu-section">
              <div className="account-menu-section-label">Admin</div>
              <Link to="/admin/trash" className="account-menu-item" onClick={() => setOpen(false)}>
                Recently Deleted
              </Link>
              <Link to="/admin/users" className="account-menu-item" onClick={() => setOpen(false)}>
                Manage Users
              </Link>
            </div>
          )}

          {isAdmin && (
            <ViewAsSection options={ADMIN_VIEW_OPTIONS} selfRole="admin" viewAs={viewAs} onSelect={selectView} />
          )}

          {isQc && <ViewAsSection options={QC_VIEW_OPTIONS} selfRole="qc" viewAs={viewAs} onSelect={selectView} />}

          <div className="account-menu-section">
            <div className="account-menu-section-label">Theme</div>
            {THEME_OPTIONS.map((opt) => {
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`account-menu-item${active ? " account-menu-item-active" : ""}`}
                  aria-current={active}
                  onClick={() => setTheme(opt.value)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {active ? <path d="M20 6 9 17l-5-5" /> : null}
                  </svg>
                  {opt.label}
                </button>
              );
            })}
          </div>

          <Link to="/account" className="account-menu-item" onClick={() => setOpen(false)}>
            My Account
          </Link>

          <Link to="/change-password" className="account-menu-item" onClick={() => setOpen(false)}>
            Change PIN
          </Link>

          <button
            type="button"
            className="account-menu-item account-menu-item-danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
