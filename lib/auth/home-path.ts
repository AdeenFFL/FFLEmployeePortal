// Where a signed-in person lands after login / hitting /login or /pending-setup while already
// signed in. Deliberately keyed by PERMISSION, not role name — a custom role (e.g. one created
// via "Duplicate Role", or any brand-new role an admin builds from scratch) lands somewhere
// sensible based on what it can actually do, with no name-matching involved. First match in this
// list wins; add a module's own entry here only if it's worth a dedicated landing page — every
// role, including ones with none of these, falls through to the generic "/home" (never an error).
const HOME_PATH_PRIORITY: { permission: string; path: string }[] = [
  { permission: "route:/admin/users", path: "/admin/users" },
  { permission: "hr.tickets.read", path: "/hr/dashboard" },
  { permission: "hr.anonymous_feedback.read", path: "/hr/dashboard" },
];

export function resolveHomePath(grantedKeys: Set<string>): string {
  const match = HOME_PATH_PRIORITY.find((entry) => grantedKeys.has(entry.permission));
  return match?.path ?? "/home";
}
