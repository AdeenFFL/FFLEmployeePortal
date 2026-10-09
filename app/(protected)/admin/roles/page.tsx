import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RolePermissionsEditor } from "@/components/role-permissions-editor";
import { RoleFormPanel } from "@/components/role-form";
import { IconLink, IconButton } from "@/components/icon-button";
import { CopyIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { duplicateRole, deleteRole } from "./actions";
import type { PermissionGroup } from "@/types/database";

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

  const { data: permissionGroups } = await supabase
    .from("permission_groups")
    .select("*")
    .order("module")
    .order("name");

  // Every permission_group here still only ever wraps one permission in practice (true
  // many-permission bundles exist in the schema but nothing uses them yet) — this map lets the
  // page tell "module:x" coarse-access groups apart from everything else without a second admin
  // concept. See 01-platform-design-and-sop.md §11's module-onboarding convention: a module's
  // own `module:<x>` permission always gets exactly one group, named after the key, and that's
  // what surfaces here as "Module Access"; its `<module>.manage_*` fine-grained permissions get
  // groups too (same convention) but are hidden from this screen — each module's own admin area
  // is where those get configured per role instead (e.g. /hr/admin/roles).
  const { data: groupPermissionRows } = await supabase
    .from("permission_group_permissions")
    .select("permission_group_id, permissions(key)");
  const permissionKeysByGroupId = new Map<string, string[]>();
  for (const row of groupPermissionRows ?? []) {
    const key = row.permissions?.key;
    if (!key) continue;
    const list = permissionKeysByGroupId.get(row.permission_group_id) ?? [];
    list.push(key);
    permissionKeysByGroupId.set(row.permission_group_id, list);
  }

  // Fine-grained permissions that have their own module admin screen — hidden from this
  // cross-module view entirely so there's exactly one place to configure each. Add a module's
  // key prefix here once it ships its own "<module>.manage_*" config screen.
  const MODULE_OWNED_PREFIXES = ["hr."];

  const moduleAccessGroups: PermissionGroup[] = [];
  const visibleGroups: PermissionGroup[] = [];
  for (const group of permissionGroups ?? []) {
    const keys = permissionKeysByGroupId.get(group.id) ?? [];
    if (keys.length === 1 && keys[0].startsWith("module:")) {
      moduleAccessGroups.push(group);
    } else if (keys.length === 1 && MODULE_OWNED_PREFIXES.some((p) => keys[0].startsWith(p))) {
      // skip — configured from within the owning module instead
    } else {
      visibleGroups.push(group);
    }
  }

  const { data: grants } = selectedRoleId
    ? await supabase
        .from("role_permission_groups")
        .select("permission_group_id, granted_by, granted_at")
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

  const grantByGroupId = new Map((grants ?? []).map((g) => [g.permission_group_id, g]));

  const groupsByModule = new Map<string, PermissionGroup[]>();
  for (const group of visibleGroups) {
    if (!groupsByModule.has(group.module)) groupsByModule.set(group.module, []);
    groupsByModule.get(group.module)!.push(group);
  }
  const groupsByModuleEntries = [...groupsByModule.entries()];

  // "Last updated by X on Y" — once per module card, the most recent grant among that module's
  // currently-granted groups (not shown per-row anymore).
  const grantMetaByModule: Record<
    string,
    { grantedByName: string | null; grantedAt: string | null } | null
  > = {};
  for (const [moduleName, groups] of groupsByModuleEntries) {
    let latest: { granted_by: string | null; granted_at: string | null } | null = null;
    for (const group of groups) {
      const grant = grantByGroupId.get(group.id);
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
              <p className="text-sm text-slate-500">
                Toggle which permission groups this role includes.
              </p>
            </div>
          )}

          {selectedRoleId && (
            <RolePermissionsEditor
              key={selectedRoleId}
              roleId={selectedRoleId}
              moduleAccessGroups={moduleAccessGroups}
              groupsByModule={groupsByModuleEntries}
              initialGrantedIds={[...grantByGroupId.keys()]}
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
