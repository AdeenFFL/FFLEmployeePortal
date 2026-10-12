import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logAuditEvent } from "@/lib/audit/log";

// Revoking either of these, from the LAST role anywhere that still holds it, would lock every
// admin out of this module (or, for core.full_access, out of writing to persons/companies/
// org_units/roles/permissions/audit_log at the database level — see 0019_direct_role_
// permissions.sql) with no way back in. Deliberately not "the role named Admin": any role
// holding these is equally protected, and a role named "Admin" with none of them isn't
// special-cased at all — see the no-hardcoded-roles note in 01-platform-design-and-sop.md §11.
const PROTECTED_KEYS = ["route:/admin/users", "route:/admin/roles", "core.full_access"];

// For each protected key, which role_ids currently hold it — used to detect "this revoke would
// leave zero roles able to reach user/role management (or bypass RLS entirely)", regardless of
// what any of those roles happen to be named.
async function getProtectedKeyHolders(supabase: SupabaseClient<Database>) {
  const { data: protectedPermissions } = await supabase
    .from("permissions")
    .select("id, key")
    .in("key", PROTECTED_KEYS);
  const permissionIdToKey = new Map((protectedPermissions ?? []).map((p) => [p.id, p.key]));

  const { data: grantRows } = await supabase
    .from("role_permissions")
    .select("role_id, permission_id")
    .in("permission_id", [...permissionIdToKey.keys()]);
  const holdersByKey = new Map<string, Set<string>>();
  for (const row of grantRows ?? []) {
    const key = permissionIdToKey.get(row.permission_id);
    if (!key) continue;
    const holders = holdersByKey.get(key) ?? new Set();
    holders.add(row.role_id);
    holdersByKey.set(key, holders);
  }

  return { permissionIdToKey, holdersByKey };
}

// Shared by every "grant/revoke permissions for a role" entrypoint — the global /admin/roles
// screen (admin/roles/actions.ts) and each module's own scoped screen (e.g.
// hr/admin/roles/actions.ts). Callers are responsible for their OWN authorization check
// (requirePermission) and for restricting which permissionIds they allow through — this
// function trusts `changes` completely, it does not re-derive who's allowed to touch what.
export async function applyRolePermissionChanges({
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
  changes: { permissionId: string; granted: boolean }[];
  revalidatePaths: string[];
}) {
  if (changes.length === 0) return;

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", roleId)
    .maybeSingle();

  const { permissionIdToKey, holdersByKey } = await getProtectedKeyHolders(supabase);

  for (const change of changes) {
    const { data: permission } = await supabase
      .from("permissions")
      .select("key, description")
      .eq("id", change.permissionId)
      .maybeSingle();

    if (!change.granted) {
      const key = permissionIdToKey.get(change.permissionId);
      if (key) {
        const holders = holdersByKey.get(key) ?? new Set();
        if (holders.size === 1 && holders.has(roleId)) {
          throw new Error(
            `Cannot revoke '${permission?.key ?? change.permissionId}' from '${role?.name ?? roleId}' — it is the only role left with '${key}', and removing it would lock every admin out of user/role management.`,
          );
        }
      }

      const { error } = await supabase
        .from("role_permissions")
        .delete()
        .eq("role_id", roleId)
        .eq("permission_id", change.permissionId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("role_permissions").insert({
        role_id: roleId,
        permission_id: change.permissionId,
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
        permission?.description ?? permission?.key ?? change.permissionId
      } ${change.granted ? "enabled" : "disabled"}`,
    });
  }

  for (const path of revalidatePaths) revalidatePath(path);
}
