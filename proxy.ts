import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { ROLE_HOME_PATH } from "@/lib/auth/roles";
import { permissionKeyForPath } from "@/lib/auth/route-permissions";

// Paths reachable without an authenticated, active, role-assigned user. /forgot-password is
// here (unlike /unauthorized, which is only ever reached by an already-authenticated user) —
// its whole audience is someone who can't sign in at all.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/forgot-password"];

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
  const { data: profile } = await supabase
    .from("profiles")
    .select("role_id, status")
    .eq("id", user.id)
    .maybeSingle();

  // Profile may not exist yet on the very first request right after OAuth (callback creates
  // it); treat that edge case the same as "pending" rather than erroring.
  const roleId = profile?.role_id ?? null;
  const status = profile?.status ?? "Active";

  if (status !== "Active") {
    if (pathname === "/unauthorized") return response;
    return NextResponse.redirect(
      new URL("/unauthorized?reason=inactive", request.url),
    );
  }

  if (!roleId) {
    if (pathname === "/pending-setup") return response;
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  // A role-assigned user hitting /login or /pending-setup gets sent to their role home
  // (SCR-00: "redirects authenticated users to their role home screen").
  if (pathname === "/login" || pathname === "/pending-setup") {
    const { data: role } = await supabase
      .from("roles")
      .select("name")
      .eq("id", roleId)
      .maybeSingle();
    // Falls back to /home (not /login) for any role name not in the map — otherwise a custom
    // role (e.g. one created via "Duplicate Role") would redirect-loop on /login forever.
    const homePath = role ? (ROLE_HOME_PATH[role.name] ?? "/home") : undefined;
    return NextResponse.redirect(new URL(homePath ?? "/login", request.url));
  }

  const permissionKey = permissionKeyForPath(pathname);
  if (permissionKey) {
    const { data: permission } = await supabase
      .from("permissions")
      .select("id")
      .eq("key", permissionKey)
      .maybeSingle();

    // Permission key not seeded in the DB — treat like an unmapped route (allow through)
    // rather than locking everyone out over a config mismatch.
    if (permission) {
      const { data: grant } = await supabase
        .from("role_permissions")
        .select("role_id")
        .eq("role_id", roleId)
        .eq("permission_id", permission.id)
        .maybeSingle();

      if (!grant) {
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
