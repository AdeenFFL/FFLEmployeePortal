import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { ROLE_HOME_PATH, ROLE_PRIORITY } from "@/lib/auth/roles";
import { permissionKeyForPath } from "@/lib/auth/route-permissions";

// Paths reachable without an authenticated, active, role-assigned user. /forgot-password is
// here (unlike /unauthorized, which is only ever reached by an already-authenticated user) —
// its whole audience is someone who can't sign in at all.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/forgot-password", "/feedback"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user) {
    if (isPublicPath(pathname)) return response;
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/auth/callback") return response;

  // NFR-06: RBAC enforced server-side, before any page renders — not just hidden in the UI.
  // Two status columns now exist (account-level login suspension vs. person-level employment
  // status) — either one being non-Active blocks access, same as requireAdmin()/requireUser().
  const { data: account } = await supabase
    .from("user_accounts")
    .select("person_id, status, persons(status)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Account may not exist yet on the very first request right after OAuth (callback creates
  // it); treat that edge case the same as "pending" rather than erroring.
  const personId = account?.person_id ?? null;
  const isActive = account
    ? account.status === "Active" && account.persons?.status === "Active"
    : true;

  if (!isActive) {
    if (pathname === "/unauthorized") return response;
    return NextResponse.redirect(
      new URL("/unauthorized?reason=inactive", request.url),
    );
  }

  if (!personId) {
    if (pathname === "/pending-setup") return response;
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("person_id", personId);

  const roleNames = (roleRows ?? []).map((r) => r.roles?.name).filter(Boolean) as string[];

  if ((roleRows ?? []).length === 0) {
    if (pathname === "/pending-setup") return response;
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  // A role-assigned user hitting /login or /pending-setup gets sent to their role home
  // (SCR-00: "redirects authenticated users to their role home screen").
  if (pathname === "/login" || pathname === "/pending-setup") {
    // Falls back to /home (not /login) for any role name not in the map — otherwise a custom
    // role (e.g. one created via "Duplicate Role") would redirect-loop on /login forever.
    const priorityRole = ROLE_PRIORITY.find((r) => roleNames.includes(r));
    const homePath = priorityRole ? (ROLE_HOME_PATH[priorityRole] ?? "/home") : "/home";
    return NextResponse.redirect(new URL(homePath, request.url));
  }

  const permissionKey = permissionKeyForPath(pathname);
  if (permissionKey) {
    // Delegates to the has_permission() SQL function (0010_permission_groups.sql) — it already
    // aggregates across every role the person holds and every permission group each role
    // includes, so there's nothing left to join here. Missing key or genuinely ungranted both
    // resolve to `false`, which is the whole point of NULL-safe boolean SQL, but they mean
    // different things for the response below.
    const { data: permission } = await supabase
      .from("permissions")
      .select("id")
      .eq("key", permissionKey)
      .maybeSingle();

    // Permission key not seeded in the DB — treat like an unmapped route (allow through)
    // rather than locking everyone out over a config mismatch.
    if (permission) {
      const { data: granted } = await supabase.rpc("has_permission", {
        p_permission_key: permissionKey,
      });

      if (!granted) {
        return NextResponse.redirect(new URL("/unauthorized", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
