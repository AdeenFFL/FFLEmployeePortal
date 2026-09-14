"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditEvent } from "@/lib/audit/log";

// Revoking a group containing either of these from Admin would lock every admin out of this
// module with no way back in — a role-wide lockout, distinct from the single self-deactivation
// guard in app/admin/users/actions.ts.
const PROTECTED_ADMIN_ROUTE_KEYS = new Set([
  "route:/admin/users",
  "route:/admin/roles",
]);

// Batched: the Roles & Permissions screen stages toggles locally (RolePermissionsEditor) and
// commits them all at once via "Save Changes", rather than submitting per-toggle. Each changed
// group still gets its own audit log row (same granularity as every other action in this app),
// and the Admin-lockout guard is checked per-change so a batch can't sneak one through.
export async function saveRolePermissionGroups(
  roleId: string,
  changes: { permissionGroupId: string; granted: boolean }[],
) {
  const { supabase, personId, actorLabel } = await requireAdmin();
  if (changes.length === 0) return;

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", roleId)
    .maybeSingle();

  for (const change of changes) {
    const { data: group } = await supabase
      .from("permission_groups")
      .select("module, name, description")
      .eq("id", change.permissionGroupId)
      .maybeSingle();

    if (!change.granted) {
      if (role?.name === "Admin") {
        const { data: memberPermissions } = await supabase
          .from("permission_group_permissions")
          .select("permissions(key)")
          .eq("permission_group_id", change.permissionGroupId);
        const memberKeys = (memberPermissions ?? [])
          .map((m) => m.permissions?.key)
          .filter(Boolean) as string[];
        if (memberKeys.some((key) => PROTECTED_ADMIN_ROUTE_KEYS.has(key))) {
          throw new Error(
            `Cannot revoke '${group?.name ?? change.permissionGroupId}' from Admin — it would lock all admins out of this module.`,
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

  revalidatePath("/admin/roles");
}

// Copies a role's full permission-group grant set into a brand-new (non-system) role, so an
// admin can start from an existing configuration instead of granting every group from scratch.
// Note: the new role gets correct *page* access (proxy.ts's route checks are fully data-driven),
// but isn't treated as "Admin"/"HR" by the handful of Server Actions that check role.name
// literally (requireAdmin, requireHrOrAdmin) — duplicating Admin or HR won't grant their
// action-level privileges, only their page visibility. Making those checks permission-driven
// instead of name-driven is a bigger change than this button.
export async function duplicateRole(roleId: string) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const { data: source } = await supabase
    .from("roles")
    .select("name, description")
    .eq("id", roleId)
    .maybeSingle();
  if (!source) throw new Error("Role not found.");

  const { data: existing } = await supabase.from("roles").select("name");
  const takenNames = new Set((existing ?? []).map((r) => r.name));
  let newName = `${source.name} (Copy)`;
  for (let n = 2; takenNames.has(newName); n++) {
    newName = `${source.name} (Copy ${n})`;
  }

  const { data: newRole, error: insertError } = await supabase
    .from("roles")
    .insert({ name: newName, description: source.description, is_system_role: false })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const { data: grants } = await supabase
    .from("role_permission_groups")
    .select("permission_group_id")
    .eq("role_id", roleId);

  if (grants && grants.length > 0) {
    const { error: grantsError } = await supabase.from("role_permission_groups").insert(
      grants.map((g) => ({
        role_id: newRole.id,
        permission_group_id: g.permission_group_id,
        granted_by: personId,
      })),
    );
    if (grantsError) throw new Error(grantsError.message);
  }

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "CREATED",
    details: `Duplicated role '${source.name}' as '${newName}' (${grants?.length ?? 0} permission groups copied)`,
  });

  revalidatePath("/admin/roles");
  redirect(`/admin/roles?role=${newRole.id}`);
}

export async function renameRole(formData: FormData) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!id || !name) throw new Error("Name is required.");

  const { data: role } = await supabase
    .from("roles")
    .select("name, is_system_role")
    .eq("id", id)
    .maybeSingle();
  if (!role) throw new Error("Role not found.");
  if (role.is_system_role) throw new Error("System roles cannot be renamed.");

  const { error } = await supabase.from("roles").update({ name, description }).eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Renamed role '${role.name}' to '${name}'`,
  });

  revalidatePath("/admin/roles");
}

export async function deleteRole(id: string) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const { data: role } = await supabase
    .from("roles")
    .select("name, is_system_role")
    .eq("id", id)
    .maybeSingle();
  if (!role) throw new Error("Role not found.");
  if (role.is_system_role) throw new Error("System roles cannot be deleted.");

  const { count } = await supabase
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);
  if (count && count > 0) {
    throw new Error(`Cannot delete '${role.name}' — ${count} user(s) are still assigned to it.`);
  }

  const { error } = await supabase.from("roles").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "DELETED",
    details: `Deleted role '${role.name}'`,
  });

  revalidatePath("/admin/roles");
}
