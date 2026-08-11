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
