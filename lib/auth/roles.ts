// Role home-screen redirect targets, per SCR-00's redirect table.
// Adding a role home here requires a code change (Next.js needs a concrete path to redirect
// to); the *permission* that gates each route, however, stays fully data-driven — see
// role-permissions.ts and role_permissions in the database.
export const ROLE_HOME_PATH: Record<string, string> = {
  Employee: "/home",
  HR: "/hr/dashboard",
  IT: "/it/dashboard",
  Admin: "/admin/users",
};

export const DEFAULT_HOME_PATH = "/login";

// A person can now hold more than one role (user_roles is multi-role). When picking a single
// "home" screen to land on, higher-privilege roles win — Admin over HR over IT over Employee.
// Only matters once a person is ever given more than one role (not exposed in the admin UI yet),
// but the redirect logic should be correct now rather than assuming exactly one role forever.
export const ROLE_PRIORITY = ["Admin", "HR", "IT", "Employee"];
