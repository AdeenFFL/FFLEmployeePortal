import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHomePath } from "@/lib/auth/home-path";
import { getGrantedPermissionKeys } from "@/lib/auth/granted-permissions";

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

  const admin = createAdminClient();

  let { data: account } = await supabase
    .from("user_accounts")
    .select("person_id, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let personId: string;
  let accountStatus: string;

  // F-03: no self-registration. First-ever login creates a persons + user_accounts row rather
  // than granting access automatically — unless an Admin pre-provisioned this email via the
  // invited_users staging table (SCR-33 "Add New User"), in which case its role/department/site
  // apply immediately instead of landing on /pending-setup.
  if (!account) {
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Unknown User";

    // Store the login email normalized so later admin-side lookups by email (e.g. checking
    // whether a real account already exists for an invite) match reliably regardless of the
    // casing Azure AD/Google happens to return.
    const normalizedEmail = user.email!.trim().toLowerCase();

    const { data: invitation } = await admin
      .from("invited_users")
      .select(
        "role_id, department, site, status, notes, employee_code, designation, date_of_joining",
      )
      .eq("email", normalizedEmail)
      .maybeSingle();

    const { data: createdPerson, error: personError } = await admin
      .from("persons")
      .insert({
        full_name: displayName, // real OAuth name always wins over anything on the invite
        status: invitation?.status ?? "Active",
        notes: invitation?.notes ?? null,
        employee_code: invitation?.employee_code ?? null,
        designation: invitation?.designation ?? null,
        date_of_joining: invitation?.date_of_joining ?? null,
      })
      .select("id, status")
      .single();

    if (personError || !createdPerson) {
      return NextResponse.redirect(
        new URL("/login?error=provisioning_failed", request.url),
      );
    }

    const { data: createdAccount, error: accountError } = await admin
      .from("user_accounts")
      .insert({
        person_id: createdPerson.id,
        auth_user_id: user.id,
        email: normalizedEmail,
        auth_method: "microsoft",
        last_login_at: new Date().toISOString(),
      })
      .select("person_id, status")
      .single();

    if (accountError || !createdAccount) {
      // Don't leave an orphaned persons row with no account behind.
      await admin.from("persons").delete().eq("id", createdPerson.id);
      return NextResponse.redirect(
        new URL("/login?error=provisioning_failed", request.url),
      );
    }

    if (invitation?.role_id) {
      const { error: roleError } = await admin.from("user_roles").insert({
        person_id: createdPerson.id,
        role_id: invitation.role_id,
      });
      if (roleError) {
        await admin.from("user_accounts").delete().eq("person_id", createdPerson.id);
        await admin.from("persons").delete().eq("id", createdPerson.id);
        return NextResponse.redirect(
          new URL("/login?error=provisioning_failed", request.url),
        );
      }
    }

    // Best-effort consume. If this fails the row lingers harmlessly — the admin users screen
    // hides any invitation whose email already has a real account, so it never resurfaces.
    if (invitation) {
      await admin.from("invited_users").delete().eq("email", normalizedEmail);
    }

    account = createdAccount;
    personId = createdAccount.person_id;
    accountStatus = createdAccount.status;
  } else {
    await admin
      .from("user_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("auth_user_id", user.id);

    personId = account.person_id;
    accountStatus = account.status;
  }

  if (accountStatus !== "Active") {
    return NextResponse.redirect(
      new URL("/unauthorized?reason=inactive", request.url),
    );
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("person_id", personId);

  if ((roleRows ?? []).length === 0) {
    return NextResponse.redirect(new URL("/pending-setup", request.url));
  }

  // Resolved from permissions, not role name — any role, including a brand-new custom one,
  // lands somewhere sensible with no name-matching involved (see lib/auth/home-path.ts).
  const grantedKeys = await getGrantedPermissionKeys(supabase, personId);
  return NextResponse.redirect(new URL(resolveHomePath(grantedKeys), request.url));
}
