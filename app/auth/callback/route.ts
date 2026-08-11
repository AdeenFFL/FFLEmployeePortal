import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_HOME_PATH } from "@/lib/auth/roles";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url),
    );
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("role_id, status")
    .eq("id", user.id)
    .maybeSingle();

  const admin = createAdminClient();

  // F-03: no self-registration. First-ever login creates a profile row rather than granting
  // access automatically — unless an Admin pre-provisioned this email via the invited_users
  // staging table (SCR-33 "Add New User"), in which case its role/department/site apply
  // immediately instead of landing on /pending-setup.
  if (!profile) {
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Unknown User";

    // Store the profile email normalized so later admin-side lookups by email (e.g. checking
    // whether a real profile already exists for an invite) match reliably regardless of the
    // casing Azure AD/Google happens to return.
    const normalizedEmail = user.email!.trim().toLowerCase();

    const { data: invitation } = await admin
      .from("invited_users")
      .select(
        "role_id, department, site, status, notes, employee_code, designation, date_of_joining",
      )
      .eq("email", normalizedEmail)
      .maybeSingle();

    const { data: created, error: insertError } = await admin
      .from("profiles")
      .insert({
        id: user.id,
        email: normalizedEmail,
        display_name: displayName, // real OAuth name always wins over anything on the invite
        role_id: invitation?.role_id ?? null,
        status: invitation?.status ?? "Active",
        department: invitation?.department ?? null,
        site: invitation?.site ?? null,
        notes: invitation?.notes ?? null,
        employee_code: invitation?.employee_code ?? null,
        designation: invitation?.designation ?? null,
        date_of_joining: invitation?.date_of_joining ?? null,
        last_login_at: new Date().toISOString(),
      })
      .select("role_id, status")
      .single();

    if (insertError) {
      return NextResponse.redirect(
        new URL("/login?error=provisioning_failed", request.url),
      );
    }
    profile = created;

    // Best-effort consume. If this fails the row lingers harmlessly — the admin users screen
    // hides any invitation whose email already has a real profile, so it never resurfaces.
    if (invitation) {
      await admin.from("invited_users").delete().eq("email", normalizedEmail);
    }
  } else {
    await admin
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  if (profile.status !== "Active") {
    return NextResponse.redirect(
      new URL("/unauthorized?reason=inactive", request.url),
    );
  }

  if (!profile.role_id) {
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .maybeSingle();

  // Falls back to /home for any role name not in the map (e.g. a custom role created via
  // "Duplicate Role") — "unknown_role" stays reserved for the genuine data-integrity case where
  // role_id points at nothing.
  const homePath = role ? (ROLE_HOME_PATH[role.name] ?? "/home") : undefined;

  return NextResponse.redirect(
    new URL(homePath ?? "/login?error=unknown_role", request.url),
  );
}
