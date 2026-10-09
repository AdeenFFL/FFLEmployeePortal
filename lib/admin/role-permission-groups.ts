import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logAuditEvent } from "@/lib/audit/log";

// Revoking a group containing either of these, from the LAST role anywhere that still holds it,
// would lock every admin out of this module with no way back in — a system-wide lockout,
// distinct from the single self-deactivation guard in app/admin/users/actions.ts. Deliberately
// not "the role named Admin": any role holding these is equally protected, and a role named
// "Admin" with neither of these isn't special-cased at all — see the no-hardcoded-roles note in
// 01-platform-design-and-sop.md §11.
const PROTECTED_ADMIN_ROUTE_KEYS = ["route:/admin/users", "route:/admin/roles"];

// For each protected key, which role_ids currently hold a permission group containing it —
// used to detect "this revoke would leave zero roles able to reach user/role management",
// regardless of what any of those roles happen to be named.
async function getProtectedKeyHolders(supabase: SupabaseClient<Database>) {
  const { data: protectedPermissions } = await supabase
    .from("permissions")
    .select("id, key")
    .in("key", PROTECTED_ADMIN_ROUTE_KEYS);
  const permissionIdToKey = new Map((protectedPermissions ?? []).map((p) => [p.id, p.key]));

  const { data: memberRows } = await supabase
    .from("permission_group_permissions")
    .select("permission_group_id, permission_id")
    .in("permission_id", [...permissionIdToKey.keys()]);
  const groupIdToKeys = new Map<string, Set<string>>();
  for (const row of memberRows ?? []) {
    const key = permissionIdToKey.get(row.permission_id);
    if (!key) continue;
    const set = groupIdToKeys.get(row.permission_group_id) ?? new Set();
    set.add(key);
    groupIdToKeys.set(row.permission_group_id, set);
  }

  const { data: grantRows } = await supabase
    .from("role_permission_groups")
    .select("role_id, permission_group_id");
  const holdersByKey = new Map<string, Set<string>>();
  for (const row of grantRows ?? []) {
    const keys = groupIdToKeys.get(row.permission_group_id);
    if (!keys) continue;
    for (const key of keys) {
      const holders = holdersByKey.get(key) ?? new Set();
      holders.add(row.role_id);
      holdersByKey.set(key, holders);
    }
  }

  return { groupIdToKeys, holdersByKey };
}

// Shared by every "grant/revoke permission groups for a role" entrypoint — the global
// /admin/roles screen (admin/roles/actions.ts) and each module's own scoped screen (e.g.
// hr/admin/roles/actions.ts). Callers are responsible for their OWN authorization check
// (requirePermission) and for restricting which permissionGroupIds they allow through — this
// function trusts `changes` completely, it does not re-derive who's allowed to touch what.
export async function applyRolePermissionGroupChanges({
  supabase,
  personId,
  actorLabel,
  roleId,
  changes,
  revalidatePaths,
}: {
  supabase: SupabaseClient<Database>;
  personId: string;
  actorLabel: string;
  roleId: string;
  changes: { permissionGroupId: string; granted: boolean }[];
  revalidatePaths: string[];
}) {
  if (changes.length === 0) return;

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", roleId)
    .maybeSingle();

  const { groupIdToKeys, holdersByKey } = await getProtectedKeyHolders(supabase);

  for (const change of changes) {
    const { data: group } = await supabase
      .from("permission_groups")
      .select("module, name, description")
      .eq("id", change.permissionGroupId)
      .maybeSingle();

    if (!change.granted) {
      const keys = groupIdToKeys.get(change.permissionGroupId) ?? new Set();
      for (const key of keys) {
        const holders = holdersByKey.get(key) ?? new Set();
        if (holders.size === 1 && holders.has(roleId)) {
          throw new Error(
            `Cannot revoke '${group?.name ?? change.permissionGroupId}' from '${role?.name ?? roleId}' — it is the only role left with '${key}', and removing it would lock every admin out of user/role management.`,
          );
        }
      }

      const { error } = await supabase
        .from("role_permission_groups")
        .delete()
        .eq("role_id", roleId)
        .eq("permission_group_id", change.permissionGroupId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("role_permission_groups").insert({
        role_id: roleId,
        permission_group_id: change.permissionGroupId,
        granted_by: personId,
      });
      if (error && error.code !== "23505") throw new Error(error.message); // idempotent on dup
    }

    await logAuditEvent({
      supabase,
      actorId: personId,
      actorLabel,
      module: "admin",
      action: "MODIFIED",
      details: `Changed '${role?.name ?? roleId}' permissions: ${
        group?.description ?? group?.name ?? change.permissionGroupId
      } ${change.granted ? "enabled" : "disabled"}`,
    });
  }

  for (const path of revalidatePaths) revalidatePath(path);
}
