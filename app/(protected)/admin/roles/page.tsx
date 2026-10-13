import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { RoleFormPanel } from "@/components/role-form";
import { IconLink, IconButton } from "@/components/icon-button";
import { CopyIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { duplicateRole, deleteRole, saveRolePermissions } from "./actions";
import type { Permission } from "@/types/database";

export default async function AdminRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; editRole?: string; compose?: string }>;
}) {
  const { role: roleParam, editRole, compose } = await searchParams;
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

  // A module's own `module:<x>` permission always surfaces here as "Module Access"; its
  // `<module>.*` fine-grained permissions are hidden from this screen entirely once that module
  // ships its own config screen — see 01-platform-design-and-sop.md §11's module-onboarding
  // convention. Add a module's key prefix here once it ships its own "<module>.*" config screen
  // (e.g. /hr/admin/roles).
  const MODULE_OWNED_PREFIXES = ["hr."];

  const moduleAccessPermissions: Permission[] = [];
  const visiblePermissions: Permission[] = [];
  for (const permission of permissions ?? []) {
    if (permission.key.startsWith("module:")) {
      moduleAccessPermissions.push(permission);
    } else if (MODULE_OWNED_PREFIXES.some((p) => permission.key.startsWith(p))) {
      // skip — configured from within the owning module instead
    } else {
      visiblePermissions.push(permission);
    }
  }

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
  for (const permission of visiblePermissions) {
    const module = permission.module ?? "core";
    if (!permissionsByModule.has(module)) permissionsByModule.set(module, []);
    permissionsByModule.get(module)!.push(permission);
  }
  const permissionsByModuleEntries = [...permissionsByModule.entries()];

  // "Last updated by X on Y" — once per module card, the most recent grant among that module's
  // currently-granted permissions (not shown per-row anymore).
  const grantMetaByModule: Record<
    string,
    { grantedByName: string | null; grantedAt: string | null } | null
  > = {};
  for (const [moduleName, modulePermissions] of permissionsByModuleEntries) {
    let latest: { granted_by: string | null; granted_at: string | null } | null = null;
    for (const permission of modulePermissions) {
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
        action={
          <Link
            href={`/admin/roles?role=${selectedRoleId}&compose=new`}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Role
          </Link>
        }
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
                <div className="flex items-center gap-1 px-3 pb-2 pt-1">
                  <form action={duplicateRole.bind(null, r.id)}>
                    <IconButton
                      icon={<CopyIcon className="h-4 w-4" />}
                      label="Duplicate role"
                      tone="primary"
                    />
                  </form>
                  {!r.is_system_role && (
                    <>
                      <IconLink
                        href={`/admin/roles?role=${selectedRoleId}&editRole=${r.id}`}
                        icon={<PencilIcon className="h-4 w-4" />}
                        label="Edit role"
                      />
                      <form action={deleteRole.bind(null, r.id)}>
                        <IconButton
                          icon={<TrashIcon className="h-4 w-4" />}
                          label="Delete role"
                          tone="danger"
                        />
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
              <p className="text-sm text-slate-500">Toggle which permissions this role has.</p>
            </div>
          )}

          {selectedRoleId && (
            <RolePermissionsEditor
              key={selectedRoleId}
              roleId={selectedRoleId}
              moduleAccessPermissions={moduleAccessPermissions}
              permissionsBySection={permissionsByModuleEntries}
              initialGrantedIds={[...grantByPermissionId.keys()]}
              grantMetaBySection={grantMetaByModule}
              saveAction={saveRolePermissions}
            />
          )}
        </div>
      </div>

      {/* key forces a fresh mount on every real navigation that shows one of these panels —
          see components/use-dismissable.ts's header comment for why this is required. */}
      {roleBeingEdited && (
        <RoleFormPanel
          key={Date.now()}
          closeHref={`/admin/roles?role=${selectedRoleId}`}
          mode="edit"
          role={roleBeingEdited}
        />
      )}
      {compose === "new" && (
        <RoleFormPanel
          key={Date.now()}
          closeHref={`/admin/roles?role=${selectedRoleId}`}
          mode="new"
          role={null}
        />
      )}
    </div>
  );
}
