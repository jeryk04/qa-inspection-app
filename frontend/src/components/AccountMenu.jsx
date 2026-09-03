import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS } from "../lib/format";

// The role experiences an admin can preview -- null is "Admin" itself (their
// own unrestricted view), so it's listed alongside the other three instead
// of needing separate "switch view" vs. "back to admin" affordances.
const VIEW_OPTIONS = [null, "qc", "operator", "engineer"];

function initialsFor(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Header's account/settings menu -- avatar + name trigger a dropdown with
// the account-level actions (switch role view, logout) instead of laying
// each one out as its own header button. The "View as" section only renders
// for admins (viewAs/onSelectView are meaningless for any other role).
export default function AccountMenu({ user, viewAs, onSelectView, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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
            <div className="account-menu-section">
              <div className="account-menu-section-label">View as</div>
              {VIEW_OPTIONS.map((role) => {
                const active = viewAs === role;
                return (
                  <button
                    key={role ?? "admin"}
                    type="button"
                    className={`account-menu-item${active ? " account-menu-item-active" : ""}`}
                    aria-current={active}
                    onClick={() => {
                      setOpen(false);
                      if (!active) onSelectView(role);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {active ? <path d="M20 6 9 17l-5-5" /> : null}
                    </svg>
                    {ROLE_LABELS[role ?? "admin"]}
                  </button>
                );
              })}
            </div>
          )}

          <Link to="/change-password" className="account-menu-item" onClick={() => setOpen(false)}>
            Change Password
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
