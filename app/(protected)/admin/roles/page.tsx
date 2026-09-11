import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { RoleFormPanel } from "@/components/role-form";
import { duplicateRole, deleteRole } from "./actions";
import type { Permission } from "@/types/database";

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; editRole?: string }>;
}) {
  const { role: roleParam, editRole } = await searchParams;
  const supabase = await createClient();

  const { data: roles } = await supabase.from("roles").select("*").order("name");
  const selectedRoleId = roleParam ?? roles?.[0]?.id;
  const selectedRole = (roles ?? []).find((r) => r.id === selectedRoleId);
  const roleBeingEdited = editRole ? (roles ?? []).find((r) => r.id === editRole) : undefined;

  const { data: permissions } = await supabase
    .from("permissions")
    .select("*")
    .order("module")
    .order("key");

  const { data: grants } = selectedRoleId
    ? await supabase
        .from("role_permissions")
        .select("permission_id, granted_by, granted_at")
        .eq("role_id", selectedRoleId)
    : { data: [] };

  const { data: persons } = await supabase.from("persons").select("id, full_name");
  const displayNameById = new Map((persons ?? []).map((p) => [p.id, p.full_name]));

  // Per-role user count, for the role list's subtitle (falls back to this when the role has no
  // hand-written description). Reads user_roles rather than a single role_id column now that a
  // person can hold more than one role — the count is "how many people hold this role", which
  // may double-count a person who holds it twice (shouldn't happen, but not enforced by a
  // uniqueness constraint on user_roles).
  const { data: roleAssignments } = await supabase.from("user_roles").select("role_id");
  const userCountByRoleId = new Map<string, number>();
  for (const assignment of roleAssignments ?? []) {
    userCountByRoleId.set(
      assignment.role_id,
      (userCountByRoleId.get(assignment.role_id) ?? 0) + 1,
    );
  }

  const grantByPermissionId = new Map((grants ?? []).map((g) => [g.permission_id, g]));

  const permissionsByModule = new Map<string, Permission[]>();
  for (const permission of permissions ?? []) {
    const moduleName = permission.module ?? "Other";
    if (!permissionsByModule.has(moduleName)) permissionsByModule.set(moduleName, []);
    permissionsByModule.get(moduleName)!.push(permission);
  }
  const permissionsByModuleEntries = [...permissionsByModule.entries()];

  // "Last updated by X on Y" — once per module card, the most recent grant among that module's
  // currently-granted permissions (not shown per-row anymore).
  const grantMetaByModule: Record<
    string,
    { grantedByName: string | null; grantedAt: string | null } | null
  > = {};
  for (const [moduleName, perms] of permissionsByModuleEntries) {
    let latest: { granted_by: string | null; granted_at: string | null } | null = null;
    for (const permission of perms) {
      const grant = grantByPermissionId.get(permission.id);
      if (!grant) continue;
      if (!latest || (grant.granted_at ?? "") > (latest.granted_at ?? "")) {
        latest = grant;
      }
    }
    grantMetaByModule[moduleName] = latest
      ? {
          grantedByName: latest.granted_by
            ? (displayNameById.get(latest.granted_by) ?? "Unknown")
            : "System default",
          grantedAt: latest.granted_at,
        }
      : null;
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Roles & Permissions"
        description="Configure system access levels and operational capabilities."
      />

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {(roles ?? []).map((r) => {
            const active = r.id === selectedRoleId;
            const subtitle = r.description ?? `${userCountByRoleId.get(r.id) ?? 0} Users`;
            return (
              <div key={r.id} className={`rounded-xl ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                <Link href={`/admin/roles?role=${r.id}`} className="block px-4 pt-3">
                  <p
                    className={`text-sm font-semibold ${
                      active ? "text-blue-700" : "text-slate-800"
                    }`}
                  >
                    {r.name}
                  </p>
                  <p className="text-xs text-slate-500">{subtitle}</p>
                </Link>
                <div className="flex gap-3 px-4 pb-3 pt-1 text-xs">
                  <form action={duplicateRole.bind(null, r.id)}>
                    <button type="submit" className="font-medium text-blue-600 hover:underline">
                      Duplicate
                    </button>
                  </form>
                  {!r.is_system_role && (
                    <>
                      <Link
                        href={`/admin/roles?role=${selectedRoleId}&editRole=${r.id}`}
                        className="font-medium text-slate-500 hover:underline"
                      >
                        Edit
                      </Link>
                      <form action={deleteRole.bind(null, r.id)}>
                        <button type="submit" className="font-medium text-red-600 hover:underline">
                          Delete
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex-1">
          {selectedRole && (
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedRole.name} Permissions
              </h2>
              <p className="text-sm text-slate-500">
                Configure specific module access levels for this role.
              </p>
            </div>
          )}

          {selectedRoleId && (
            <RolePermissionsEditor
              key={selectedRoleId}
              roleId={selectedRoleId}
              permissionsByModule={permissionsByModuleEntries}
              initialGrantedIds={[...grantByPermissionId.keys()]}
              grantMetaByModule={grantMetaByModule}
            />
          )}
        </div>
      </div>

      {roleBeingEdited && (
        <RoleFormPanel
          closeHref={`/admin/roles?role=${selectedRoleId}`}
          role={roleBeingEdited}
        />
      )}
    </div>
  );
}
