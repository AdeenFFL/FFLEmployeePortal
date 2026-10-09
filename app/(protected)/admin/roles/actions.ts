"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAuditEvent } from "@/lib/audit/log";
import { applyRolePermissionGroupChanges } from "@/lib/admin/role-permission-groups";

// Batched: the Roles & Permissions screen stages toggles locally (RolePermissionsEditor) and
// commits them all at once via "Save Changes", rather than submitting per-toggle. This is the
// GLOBAL entrypoint (any permission_group_id, any module) — gated by route:/admin/roles. A
// module's own scoped screen (e.g. hr/admin/roles/actions.ts) calls the same shared
// applyRolePermissionGroupChanges() but behind its own permission and restricted to its own
// module's groups only.
export async function saveRolePermissionGroups(
  roleId: string,
  changes: { permissionGroupId: string; granted: boolean }[],
) {
  const { supabase, personId, actorLabel } = await requirePermission("route:/admin/roles");
  await applyRolePermissionGroupChanges({
    supabase,
    personId,
    actorLabel,
    roleId,
    changes,
    revalidatePaths: ["/admin/roles"],
  });
}

// A genuinely blank-slate role — no permission groups granted at all, by design. The admin picks
// Module Access and (inside each module) its fine-grained permissions afterward, same as this
// role was built from scratch rather than copied from one of the 4 seed roles — there is nothing
// in this codebase that assumes a role is, or descends from, "Admin"/"HR"/"IT"/"Employee".
export async function createRole(formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission("route:/admin/roles");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) throw new Error("Name is required.");

  const { data: newRole, error } = await supabase
    .from("roles")
    .insert({ name, description, is_system_role: false })
    .select("id")
    .single();
  if (error) {
    throw new Error(error.code === "23505" ? `A role named '${name}' already exists.` : error.message);
  }

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "CREATED",
    details: `Created role '${name}'`,
  });

  revalidatePath("/admin/roles");
  redirect(`/admin/roles?role=${newRole.id}`);
}

// Copies a role's full permission-group grant set into a brand-new (non-system) role, so an
// admin can start from an existing configuration instead of granting every group from scratch.
// Every Server Action authorization check in this codebase is now permission-driven
// (requirePermission), not role-name-driven, so a duplicated role gets correct *action* access
// too, not just page visibility — whatever it was granted is exactly what it can do.
export async function duplicateRole(roleId: string) {
  const { supabase, personId, actorLabel } = await requirePermission("route:/admin/roles");

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
  const { supabase, personId, actorLabel } = await requirePermission("route:/admin/roles");

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
  const { supabase, personId, actorLabel } = await requirePermission("route:/admin/roles");

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
