// Where a signed-in person lands after login / hitting /login or /pending-setup while already
// signed in. Every role lands on the generic "/home" now — it's a real landing page (quick-action
// cards: raise a ticket, my assets, my requests, plus module dashboards for staff who hold them),
// not just a fallback, so there's no reason for admins/HR staff to skip past it anymore. Kept as
// a priority list (rather than a bare constant) in case a future module ever earns its own
// dedicated landing page again.
const HOME_PATH_PRIORITY: { permission: string; path: string }[] = [];

export function resolveHomePath(grantedKeys: Set<string>): string {
  const match = HOME_PATH_PRIORITY.find((entry) => grantedKeys.has(entry.permission));
  return match?.path ?? "/home";
}
