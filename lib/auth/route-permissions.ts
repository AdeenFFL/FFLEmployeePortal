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
  // IT module — Service Management track (08-it-service-management-plan.md §4).
  "/it/my-tickets": "module:it",
  "/it/tickets": "it.tickets.read",
  "/it/my-onboarding": "module:it",
  // More specific prefixes first — permissionKeyForPath returns the first match.
  "/it/my-offboarding/new-for-employee": "hr.offboarding.create_for_site_users",
  "/it/my-offboarding/new": "hr.offboarding.create_self",
  "/it/my-offboarding": "module:it",
  // Unified staff queue (tickets + onboarding/offboarding/replacement) — needs either
  // it.tickets.read or it.onboarding.read, which this single-key map can't express as "any of".
  // Gated at module:it here; the page itself only queries/shows each half the viewer actually
  // holds the specific permission for (same permissive-then-filter shape as the "/it" catch-all
  // below), same as sidebar.tsx's "Requests" nav entry decides visibility the same way.
  "/it/requests": "module:it",
  // More specific prefix first — permissionKeyForPath returns the first match. The two kinds
  // left on this route (Onboarding, Replacement — Offboarding moved to its own dedicated,
  // permission-split screens under /it/my-offboarding/) each have their own permission,
  // hr.onboarding.create / hr.replacement.create, which this single-key map can't express as
  // "any of"; gated loosely at module:it here, same shape as /it/settings, and the page itself
  // enforces the per-kind permission on submit.
  "/it/onboarding/new": "module:it",
  "/it/onboarding": "it.onboarding.read",
  // Consumable stock (javaria_it_0022) — before the /it/inventory prefix.
  "/it/inventory/stock": "it.stock.read",
  "/it/inventory": "it.assets.read",
  // Inventory track: every employee sees the assets they hold (RLS limits rows to their own).
  "/it/my-assets": "module:it",
  "/it/admin/roles": "it.manage_role_permissions",
  // Unified IT Settings (tickets, onboarding task owners, sites & IT staff — IT Settings
  // redesign). Old /it/settings/tickets, /it/settings/sites, /it/settings/owners now just
  // redirect here. Gated loosely like /it/requests — the route needs module:it, and the page
  // itself only shows/enables each tab for the permission it actually requires
  // (it.ticket_settings.update for Tickets/Sites, it.onboarding.assign for Onboarding Tasks).
  "/it/settings": "module:it",
  // SCR-06: the IT Dashboard is for IT team members who handle tickets, not every employee with
  // module:it — reconciled per Javaria's own note anticipating this conflict (she built the real
  // dashboard; it.tickets.read replaces the earlier module:it placeholder gate).
  "/it/dashboard": "it.tickets.read",
  "/it/reports": "it.tickets.read",
  // Procurement masters (javaria_it_0009, 09-it-procurement-plan.md Phase 1).
  // Read-only for procurement staff / approvers too (javaria_it_0013): the pages check
  // it.can_read_procurement_masters() and show the edit forms only with the .update key.
  "/it/procurement/vendors": "module:it",
  "/it/procurement/products": "module:it",
  "/it/procurement/settings": "it.procurement_settings.update",
  // Demands (javaria_it_0010). The queue and demand pages stay at module:it: RLS limits rows to
  // the viewer's own demands unless they hold it.demands.read / read_all.
  "/it/procurement/demands/new": "it.demands.create",
  "/it/procurement/demands": "module:it",
  // Department-head approval inbox (javaria_it_0011). /settings/approvers falls under
  // /it/procurement/settings above.
  // Demand OR invoice approvers (javaria_it_0014); the page shows only what the viewer approves.
  "/it/procurement/approvals": "module:it",
  // Finance inbox (javaria_it_0015).
  "/it/procurement/finance": "it.payments.update",
  // Procurement reports (Phase 7): procurement staff OR Finance — the page and the CSV route
  // check any of it.demands.read / read_all / it.payments.update themselves.
  "/it/procurement/reports": "module:it",
  // Invoice package (javaria_it_0017): RLS on it.invoices limits it to procurement staff,
  // invoice approvers and Finance; the page 404s for anyone else.
  "/it/procurement/invoices": "module:it",
  // Procurement landing (redirects to Demands) — after the specific /it/procurement/* entries.
  "/it/procurement": "module:it",
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
// The "/it" catch-all exists purely as a fallback for any future /it/* page that forgets to add
// its own specific entry — every existing /it/* page above has its own, more precise gate.

export function permissionKeyForPath(pathname: string): string | null {
  for (const [route, permissionKey] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return permissionKey;
    }
  }
  return null;
}
