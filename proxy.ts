import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { resolveHomePath } from "@/lib/auth/home-path";
import { getGrantedPermissionKeys } from "@/lib/auth/granted-permissions";
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
  // status) — either one being non-Active blocks access, same as requirePermission()/requireActiveUser().
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
    .select("role_id")
    .eq("person_id", personId);

  if ((roleRows ?? []).length === 0) {
    if (pathname === "/pending-setup") return response;
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  // A role-assigned user hitting /login or /pending-setup gets sent to their role home
  // (SCR-00: "redirects authenticated users to their role home screen"). Resolved from
  // permissions, not role name — any role, including a brand-new custom one, lands somewhere
  // sensible with no name-matching involved (see lib/auth/home-path.ts).
  if (pathname === "/login" || pathname === "/pending-setup") {
    const grantedKeys = await getGrantedPermissionKeys(supabase, personId);
    return NextResponse.redirect(new URL(resolveHomePath(grantedKeys), request.url));
  }

  const permissionKey = permissionKeyForPath(pathname);
  if (permissionKey) {
    // route_permission_allowed() (0045) collapses what used to be two sequential round trips
    // (does this key exist in `permissions`? -> is it granted?) into one, since this runs on
    // every single protected-route navigation. Same fail-open behavior as before: a permission
    // key not seeded in the DB allows the route through rather than locking everyone out over a
    // config mismatch — the function does that check internally now.
    const { data: allowed } = await supabase.rpc("route_permission_allowed", {
      p_permission_key: permissionKey,
    });

    if (!allowed) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
