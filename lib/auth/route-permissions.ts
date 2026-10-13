// Static map of protected route prefixes -> the permission key (from the `permissions` table)
// required to access them. This map only tells the proxy *which* permission a route needs —
// Next.js needs a concrete path for that. The actual role -> permission relationship it checks
// against is fully data-driven via role_permissions, so adding a role or changing who can reach
// a route is a database change, not a code change (NFR-09).
//
// Routes not listed here are allowed through for any authenticated, active, role-assigned user
// (a permissive default for this pass — tightening to default-deny is a future NFR-06 hardening
// step once more modules exist).
export const ROUTE_PERMISSIONS: Record<string, string> = {
  "/hr/dashboard": "module:hr",
  "/hr/tickets": "module:hr",
  "/hr/feedback/anonymous": "hr.anonymous_feedback.read",
  "/hr/feedback": "hr.tickets.read",
  "/hr/admin/categories": "hr.categories.update",
  "/hr/admin/roles": "hr.manage_role_permissions",
  "/it/dashboard": "module:it",
  // IT module — Service Management track (08-it-service-management-plan.md §4).
  "/it/my-tickets": "module:it",
  "/it/tickets": "it.tickets.read",
  "/it/my-onboarding": "module:it",
  // More specific prefix first — permissionKeyForPath returns the first match.
  "/it/onboarding/new": "it.onboarding.create",
  "/it/onboarding": "it.onboarding.read",
  "/it/inventory": "it.assets.read",
  // Catch-all fallback for any /it/* page not explicitly listed above — must stay last among
  // the /it/* entries so the more specific ones above win first (permissionKeyForPath returns
  // the first match in insertion order).
  "/it": "module:it",
  "/admin/users": "route:/admin/users",
  "/admin/roles": "route:/admin/roles",
  "/admin/departments": "route:/admin/departments",
  "/admin/sites": "route:/admin/sites",
  "/admin/audit-log": "route:/admin/audit-log",
};
// /home and /profile are deliberately NOT listed here: every active, role-assigned person needs
// both regardless of role, so there is nothing to ever toggle — they fall through to this map's
// permissive default (routes with no entry are allowed through) instead of carrying a dead
// permission that was granted to literally every role anyway.
//
// /it/dashboard has its own explicit entry above (same key, module:it, as the catch-all would
// give it anyway) purely for readability — the "/it" catch-all exists as a fallback for any
// future /it/* page that forgets to add its own entry, not as the primary gate for existing ones.

export function permissionKeyForPath(pathname: string): string | null {
  for (const [route, permissionKey] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return permissionKey;
    }
  }
  return null;
}
