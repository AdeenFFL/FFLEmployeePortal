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
  "/hr/feedback/anonymous": "hr.manage_anonymous_feedback",
  "/hr/feedback": "hr.manage_tickets",
  "/hr/admin/categories": "hr.manage_categories",
  "/hr/admin/roles": "route:/admin/roles",
  "/it/dashboard": "route:/it/dashboard",
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

export function permissionKeyForPath(pathname: string): string | null {
  for (const [route, permissionKey] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return permissionKey;
    }
  }
  return null;
}
