import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UserFormPanel } from "./user-form";
import { UsersDirectory, type InviteRow, type UserRow } from "./users-directory";
import { PageHeader } from "@/components/page-header";
import { PlusIcon } from "@/components/icons";
import type { UserStatus, AuthMethod, EmploymentType } from "@/types/database";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    compose?: string;
    edit?: string;
    tab?: string;
  }>;
}) {
  const { compose, edit, tab } = await searchParams;
  const supabase = await createClient();

  const { data: roles } = await supabase.from("roles").select("*").order("name");
  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));

  const { data: departments } = await supabase
    .from("org_units")
    .select("id, name")
    .eq("type", "Department")
    .eq("is_active", true)
    .order("name");

  const { data: sites } = await supabase
    .from("org_units")
    .select("id, name")
    .eq("type", "Site")
    .eq("is_active", true)
    .order("name");

  // Existing (provisioned) login emails, to anti-join pending invitations. Login email now
  // lives on user_accounts, not persons.
  const { data: allAccounts } = await supabase.from("user_accounts").select("email");
  const existingEmails = new Set((allAccounts ?? []).map((a) => a.email));

  // Everyone; search and the role / status filters run in the browser (users-directory.tsx).
  const { data: persons } = await supabase.from("persons").select("*").order("full_name");

  const personIds = (persons ?? []).map((p) => p.id);

  const { data: accounts } = personIds.length
    ? await supabase
        .from("user_accounts")
        .select("person_id, email, last_login_at")
        .in("person_id", personIds)
    : { data: [] };
  const accountByPersonId = new Map((accounts ?? []).map((a) => [a.person_id, a]));

  const { data: roleAssignments } = personIds.length
    ? await supabase.from("user_roles").select("person_id, role_id").in("person_id", personIds)
    : { data: [] };
  const roleIdByPersonId = new Map((roleAssignments ?? []).map((r) => [r.person_id, r.role_id]));

  const { data: invitations } = await supabase
    .from("invited_users")
    .select("*")
    .order("invited_at", { ascending: false });
  const pendingInvitations = (invitations ?? []).filter(
    (invite) => !existingEmails.has(invite.email),
  );
  // Invites staged by an IT onboarding request (Email Account task): show which one.
  const onboardingIds = pendingInvitations
    .map((i) => i.onboarding_request_id)
    .filter((id): id is string => Boolean(id));
  const { data: onboardingRequests } = onboardingIds.length
    ? await supabase.schema("it").from("onboarding_offboarding").select("id, request_number").in("id", onboardingIds)
    : { data: [] };
  const requestNumberById = new Map((onboardingRequests ?? []).map((r) => [r.id, r.request_number]));

  let panel: { mode: "new" | "edit" } & {
    initialValues: {
      id: string | null;
      email: string;
      display_name: string | null;
      role_id: string | null;
      department_id: string | null;
      site_id: string | null;
      status: UserStatus;
      notes: string | null;
      employee_code: string | null;
      designation: string | null;
      date_of_joining: string | null;
      employment_type: EmploymentType | null;
      auth_method: AuthMethod;
    };
  } | null = null;

  if (compose === "new") {
    panel = {
      mode: "new",
      initialValues: {
        id: null,
        email: "",
        display_name: null,
        role_id: null,
        department_id: null,
        site_id: null,
        status: "Active",
        notes: null,
        employee_code: null,
        designation: null,
        date_of_joining: null,
        employment_type: null,
        auth_method: "microsoft",
      },
    };
  } else if (edit) {
    const email = edit.trim().toLowerCase();
    const { data: existingAccount } = await supabase
      .from("user_accounts")
      .select("person_id, email, auth_method, persons(*)")
      .eq("email", email)
      .maybeSingle();

    if (existingAccount?.persons) {
      // limit(1): a person left with two role rows by the old save made maybeSingle() fail.
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("person_id", existingAccount.person_id)
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      panel = {
        mode: "edit",
        initialValues: {
          id: existingAccount.person_id,
          email: existingAccount.email,
          display_name: existingAccount.persons.full_name,
          role_id: roleRow?.role_id ?? null,
          department_id: existingAccount.persons.department_id,
          site_id: existingAccount.persons.site_id,
          status: existingAccount.persons.status,
          notes: existingAccount.persons.notes,
          employee_code: existingAccount.persons.employee_code,
          designation: existingAccount.persons.designation,
          date_of_joining: existingAccount.persons.date_of_joining,
          employment_type: existingAccount.persons.employment_type,
          auth_method: existingAccount.auth_method,
        },
      };
    } else {
      const { data: invitation } = await supabase
        .from("invited_users")
        .select("*")
        .eq("email", email)
        .maybeSingle();
      // Pending invites are always Microsoft — password accounts never pass through
      // invited_users at all (they get a real account immediately at creation).
      if (invitation) {
        panel = {
          mode: "edit",
          initialValues: {
            id: null,
            email: invitation.email,
            display_name: invitation.display_name,
            role_id: invitation.role_id,
            department_id: invitation.department_id,
            site_id: null, // invited_users has no site_id yet; the form hides Site for invites
            status: invitation.status,
            notes: invitation.notes,
            employee_code: invitation.employee_code,
            designation: invitation.designation,
            date_of_joining: invitation.date_of_joining,
            employment_type: null,
            auth_method: "microsoft",
          },
        };
      }
    }
  }

  // Keep a user's current site selectable even if it was deactivated since — otherwise the
  // select falls back to "— Select —" and saving the form silently clears persons.site_id.
  let siteOptions = sites ?? [];
  const currentSiteId = panel?.initialValues.site_id ?? null;
  if (currentSiteId && !siteOptions.some((s) => s.id === currentSiteId)) {
    const { data: currentSite } = await supabase
      .from("org_units")
      .select("id, name")
      .eq("id", currentSiteId)
      .maybeSingle();
    if (currentSite) {
      siteOptions = [...siteOptions, { id: currentSite.id, name: `${currentSite.name} (inactive)` }];
    }
  }

  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const userRows: UserRow[] = (persons ?? []).map((p) => {
    const account = accountByPersonId.get(p.id);
    const roleId = roleIdByPersonId.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.full_name,
      email: account?.email ?? null,
      roleId,
      roleName: roleId ? (roleNameById.get(roleId) ?? null) : null,
      designation: p.designation,
      department: p.department_id ? (departmentNameById.get(p.department_id) ?? null) : null,
      employeeCode: p.employee_code,
      status: p.status,
      lastLogin: account?.last_login_at ?? null,
    };
  });
  const inviteRows: InviteRow[] = pendingInvitations.map((i) => ({
    email: i.email,
    name: i.display_name,
    roleName: roleNameById.get(i.role_id) ?? null,
    invitedAt: i.invited_at,
    onboardingId: i.onboarding_request_id,
    onboardingNumber: i.onboarding_request_id ? (requestNumberById.get(i.onboarding_request_id) ?? null) : null,
  }));

  return (
    <div className="py-6">
      <PageHeader
        title="User Management"
        description="Who can sign in to the portal, their role, and whether they're active."
        action={
          <Link
            href="/admin/users?compose=new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" />
            Add user
          </Link>
        }
      />

      <UsersDirectory
        users={userRows}
        invites={inviteRows}
        roles={(roles ?? []).map((r) => ({ id: r.id, name: r.name }))}
        initialTab={tab === "invites" ? "invites" : "users"}
      />

      {panel && (
        // key forces a fresh mount (and therefore a reset useDismissable `visible`) on every
        // real navigation that shows this panel — without it, closing once (which only does a
        // local history.replaceState, not a server round trip) leaves the component's `visible`
        // state stuck at false, so a later Edit click silently does nothing.
        <UserFormPanel
          key={Date.now()}
          mode={panel.mode}
          roles={roles ?? []}
          departments={departments ?? []}
          sites={siteOptions}
          initialValues={panel.initialValues}
        />
      )}
    </div>
  );
}
