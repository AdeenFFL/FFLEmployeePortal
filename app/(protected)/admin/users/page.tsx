import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus, revokeInvitation } from "./actions";
import { UserFormPanel } from "./user-form";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getInitials } from "@/lib/format/initials";
import type { UserStatus, AuthMethod } from "@/types/database";

const STATUSES: UserStatus[] = ["Active", "Inactive", "Suspended"];

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function statusTone(status: UserStatus): "positive" | "neutral" | "negative" {
  if (status === "Active") return "positive";
  if (status === "Suspended") return "negative";
  return "neutral";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    department?: string;
    site?: string;
    status?: string;
    compose?: string;
    edit?: string;
  }>;
}) {
  const { role, department, site, status, compose, edit } = await searchParams;
  const supabase = await createClient();

  const { data: roles } = await supabase.from("roles").select("*").order("name");
  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));

  // Unfiltered pass: distinct department/site options for the filter dropdowns, and the full
  // set of existing profile emails to anti-join against pending invitations.
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("email, department, site");
  const departments = [
    ...new Set((allProfiles ?? []).map((p) => p.department).filter(Boolean)),
  ].sort() as string[];
  const sites = [
    ...new Set((allProfiles ?? []).map((p) => p.site).filter(Boolean)),
  ].sort() as string[];
  const existingEmails = new Set((allProfiles ?? []).map((p) => p.email));

  // Active org_units, for the Add/Edit User form's Department/Site <select>s (F-61).
  const { data: activeDepartments } = await supabase
    .from("org_units")
    .select("name")
    .eq("type", "Department")
    .eq("is_active", true)
    .order("name");
  const { data: activeSites } = await supabase
    .from("org_units")
    .select("name")
    .eq("type", "Site")
    .eq("is_active", true)
    .order("name");
  const departmentOptions = (activeDepartments ?? []).map((d) => d.name);
  const siteOptions = (activeSites ?? []).map((s) => s.name);

  let profilesQuery = supabase.from("profiles").select("*");
  if (role) profilesQuery = profilesQuery.eq("role_id", role);
  if (department) profilesQuery = profilesQuery.eq("department", department);
  if (site) profilesQuery = profilesQuery.eq("site", site);
  const statusFilter = STATUSES.find((s) => s === status);
  if (statusFilter) profilesQuery = profilesQuery.eq("status", statusFilter);
  const { data: profiles } = await profilesQuery.order("email");

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
      department: string | null;
      site: string | null;
      status: UserStatus;
      notes: string | null;
      employee_code: string | null;
      designation: string | null;
      date_of_joining: string | null;
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
        department: null,
        site: null,
        status: "Active",
        notes: null,
        employee_code: null,
        designation: null,
        date_of_joining: null,
        auth_method: "microsoft",
      },
    };
  } else if (edit) {
    const email = edit.trim().toLowerCase();
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (existingProfile) {
      panel = { mode: "edit", initialValues: existingProfile };
    } else {
      const { data: invitation } = await supabase
        .from("invited_users")
        .select("*")
        .eq("email", email)
        .maybeSingle();
      // Pending invites are always Microsoft — password accounts never pass through
      // invited_users at all (they get a real profiles row immediately at creation).
      if (invitation) {
        panel = {
          mode: "edit",
          initialValues: { ...invitation, id: null, auth_method: "microsoft" },
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
          <span className="font-medium text-slate-600">Department</span>
          <select
            name="department"
            defaultValue={department ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Site</span>
          <select
            name="site"
            defaultValue={site ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
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
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Site</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Login</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(profiles ?? []).map((p) => {
              const isInactive = p.status !== "Active";
              return (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      {getInitials(p.display_name ?? p.email)}
                    </div>
                    <span className={isInactive ? "text-slate-400" : "text-slate-800"}>
                      {p.display_name ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.email}</td>
                <td className="px-4 py-3">
                  {p.role_id ? (
                    roleNameById.get(p.role_id)
                  ) : (
                    <StatusPill label="Pending Role" tone="warning" />
                  )}
                </td>
                <td className="px-4 py-3">{p.department ?? "—"}</td>
                <td className="px-4 py-3">{p.site ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusPill label={p.status.toUpperCase()} tone={statusTone(p.status)} />
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDate(p.last_login_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/users?edit=${encodeURIComponent(p.email)}`}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Edit
                    </Link>
                    <form
                      action={setUserStatus.bind(
                        null,
                        p.id,
                        p.status === "Active" ? "Inactive" : "Active",
                      )}
                    >
                      <button type="submit" className="text-slate-500 hover:underline">
                        {p.status === "Active" ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
              );
            })}
            {(profiles ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
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
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Site</th>
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
                <td className="px-4 py-3">{invite.department ?? "—"}</td>
                <td className="px-4 py-3">{invite.site ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(invite.invited_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/users?edit=${encodeURIComponent(invite.email)}`}
                      className="text-blue-700 hover:underline"
                    >
                      Edit
                    </Link>
                    <form action={revokeInvitation.bind(null, invite.email)}>
                      <button type="submit" className="text-red-600 hover:underline">
                        Revoke
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {pendingInvitations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No pending invitations.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {panel && (
        <UserFormPanel
          mode={panel.mode}
          roles={roles ?? []}
          departmentOptions={departmentOptions}
          siteOptions={siteOptions}
          initialValues={panel.initialValues}
        />
      )}
    </div>
  );
}
