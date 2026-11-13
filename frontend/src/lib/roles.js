import { ROLE_LABELS } from "./format";

// A user can hold more than one role (main role + additional ones, see
// backend/src/lib/roles.js) and gets the permissions of all of them.
// user.roles is the full set; user.role is the highest one, which picks the
// Home screen. Permission checks should go through hasAnyRole, not user.role.
export function rolesOf(user) {
  return user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
}

export function hasAnyRole(user, allowed) {
  return rolesOf(user).some((r) => allowed.includes(r));
}

// "QC Inspector + Operator" -- main/highest role first.
export function rolesLabel(user) {
  const roles = rolesOf(user);
  const ordered = user?.role ? [user.role, ...roles.filter((r) => r !== user.role)] : roles;
  return ordered.map((r) => ROLE_LABELS[r] ?? r).join(" + ");
}
