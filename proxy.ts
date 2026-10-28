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
  // resolve_proxy_access() (0046) collapses what used to be 3 sequential round trips (account +
  // status lookup, role-assignment check, permission check) into one — this runs on every
  // single protected-route navigation, and the dominant cost is network latency per round trip,
  // not any one query's complexity. `permissionKey` is computed first (pure, no DB) so it can be
  // passed straight into the one RPC call.
  const permissionKey = permissionKeyForPath(pathname);
  const { data: access } = await supabase
    .rpc("resolve_proxy_access", { p_permission_key: permissionKey })
    .maybeSingle();

  const personId = access?.person_id ?? null;
  // Two status columns exist (account-level login suspension vs. person-level employment
  // status) — either one being non-Active blocks access, same as requirePermission()/
  // requireActiveUser(). No account yet (first request right after OAuth, before the callback
  // has provisioned one) is treated as active-but-pending rather than blocked.
  const isActive = access?.is_active ?? true;

  if (!isActive) {
    if (pathname === "/unauthorized") return response;
    return NextResponse.redirect(
      new URL("/unauthorized?reason=inactive", request.url),
    );
  }

  if (!personId || !access?.has_role) {
    if (pathname === "/pending-setup") return response;
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  // A role-assigned user hitting /login or /pending-setup gets sent to their role home
  // (SCR-00: "redirects authenticated users to their role home screen"). Resolved from
  // permissions, not role name — any role, including a brand-new custom one, lands somewhere
  // sensible with no name-matching involved (see lib/auth/home-path.ts). Needs the caller's
  // full permission set, not just the one key resolve_proxy_access already checked — kept as
  // its own call since it's only hit on these two paths, not every request.
  if (pathname === "/login" || pathname === "/pending-setup") {
    const grantedKeys = await getGrantedPermissionKeys(supabase, personId);
    return NextResponse.redirect(new URL(resolveHomePath(grantedKeys), request.url));
  }

  if (permissionKey && !access?.permission_ok) {
    return NextResponse.redirect(new URL("/unauthorized", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
