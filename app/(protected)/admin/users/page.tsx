import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus, revokeInvitation, resendInviteEmail, hardDeleteUser } from "./actions";
import { UserFormPanel } from "./user-form";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { OptimisticToggle } from "@/components/optimistic-toggle";
import { IconLink, IconButton } from "@/components/icon-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PencilIcon, TrashIcon, MailIcon } from "@/components/icons";
import { getInitials } from "@/lib/format/initials";
import type { UserStatus, AuthMethod, EmploymentType } from "@/types/database";

const STATUSES: UserStatus[] = ["Active", "Inactive", "Suspended"];

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    status?: string;
    compose?: string;
    edit?: string;
  }>;
}) {
  const { role, status, compose, edit } = await searchParams;
  const supabase = await createClient();

  const { data: roles } = await supabase.from("roles").select("*").order("name");
  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));

  // Existing (provisioned) login emails, to anti-join pending invitations. Login email now
  // lives on user_accounts, not persons.
  const { data: allAccounts } = await supabase.from("user_accounts").select("email");
  const existingEmails = new Set((allAccounts ?? []).map((a) => a.email));

  // Person ids matching the role filter, if any — role now lives in user_roles, not a single
  // column on the person.
  let roleFilterPersonIds: string[] | null = null;
  if (role) {
    const { data: assignments } = await supabase
      .from("user_roles")
      .select("person_id")
      .eq("role_id", role);
    roleFilterPersonIds = (assignments ?? []).map((a) => a.person_id);
  }

  let personsQuery = supabase.from("persons").select("*");
  const statusFilter = STATUSES.find((s) => s === status);
  if (statusFilter) personsQuery = personsQuery.eq("status", statusFilter);
  if (roleFilterPersonIds) personsQuery = personsQuery.in("id", roleFilterPersonIds);
  const { data: persons } = await personsQuery.order("full_name");

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

  let panel: { mode: "new" | "edit" } & {
    initialValues: {
      id: string | null;
      email: string;
      display_name: string | null;
      role_id: string | null;
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
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("person_id", existingAccount.person_id)
        .maybeSingle();

      panel = {
        mode: "edit",
        initialValues: {
          id: existingAccount.person_id,
          email: existingAccount.email,
          display_name: existingAccount.persons.full_name,
          role_id: roleRow?.role_id ?? null,
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

  return (
    <div className="py-6">
      <PageHeader
        title="User Management"
        description="Manage portal access, roles, and status for all employees."
        action={
          <Link
            href="/admin/users?compose=new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add New User
          </Link>
        }
      />

      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Role</span>
          <select
            name="role"
            defaultValue={role ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {(roles ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Apply Filters
        </button>
        <Link href="/admin/users" className="text-sm text-slate-500 hover:text-slate-700">
          Clear
        </Link>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Last Login</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(persons ?? []).map((p) => {
              const account = accountByPersonId.get(p.id);
              const roleId = roleIdByPersonId.get(p.id);
              const isInactive = p.status !== "Active";
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                        {getInitials(p.full_name ?? account?.email ?? "")}
                      </div>
                      <span className={isInactive ? "text-slate-400" : "text-slate-800"}>
                        {p.full_name ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{account?.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    {roleId ? (
                      roleNameById.get(roleId)
                    ) : (
                      <StatusPill label="Pending Role" tone="warning" />
                    )}
                  </td>
                  <td className="px-4 py-3">{p.designation ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(account?.last_login_at ?? null)}
                  </td>
                  <td className="px-4 py-3">
                    <OptimisticToggle
                      pressed={p.status === "Active"}
                      label={p.status === "Active" ? "Deactivate user" : "Reactivate user"}
                      action={setUserStatus.bind(
                        null,
                        p.id,
                        p.status === "Active" ? "Inactive" : "Active",
                      )}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <IconLink
                        href={`/admin/users?edit=${encodeURIComponent(account?.email ?? "")}`}
                        icon={<PencilIcon className="h-4 w-4" />}
                        label="Edit user"
                        tone="primary"
                      />
                      <form action={hardDeleteUser.bind(null, p.id)}>
                        <ConfirmSubmitButton
                          icon={<TrashIcon className="h-4 w-4" />}
                          label="Permanently delete user"
                          confirmMessage={`Permanently delete ${p.full_name ?? account?.email ?? "this user"}? This deletes their account and ALL associated data (tickets, messages, assets, onboarding records — including ones owned by other people but assigned to or touched by them). This cannot be undone.`}
                        />
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(persons ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No users match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-900">
        Pending Invitations
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pendingInvitations.map((invite) => (
              <tr key={invite.email}>
                <td className="px-4 py-3">{invite.display_name ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{invite.email}</td>
                <td className="px-4 py-3">{roleNameById.get(invite.role_id)}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(invite.invited_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <form action={resendInviteEmail.bind(null, invite.email)}>
                      <IconButton
                        icon={<MailIcon className="h-4 w-4" />}
                        label="Resend invite email"
                        tone="primary"
                      />
                    </form>
                    <IconLink
                      href={`/admin/users?edit=${encodeURIComponent(invite.email)}`}
                      icon={<PencilIcon className="h-4 w-4" />}
                      label="Edit invitation"
                    />
                    <form action={revokeInvitation.bind(null, invite.email)}>
                      <IconButton
                        icon={<TrashIcon className="h-4 w-4" />}
                        label="Revoke invitation"
                        tone="danger"
                      />
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {pendingInvitations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No pending invitations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {panel && (
        // key forces a fresh mount (and therefore a reset useDismissable `visible`) on every
        // real navigation that shows this panel — without it, closing once (which only does a
        // local history.replaceState, not a server round trip) leaves the component's `visible`
        // state stuck at false, so a later Edit click silently does nothing.
        <UserFormPanel
          key={Date.now()}
          mode={panel.mode}
          roles={roles ?? []}
          initialValues={panel.initialValues}
        />
      )}
    </div>
  );
}
