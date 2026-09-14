"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditEvent } from "@/lib/audit/log";

const PATH = "/admin/permission-groups";

// Gated by requireAdmin() for this pass (matches admin/roles' access model) even though the RLS
// policies underneath (0010_permission_groups.sql) already support a "module admin" — anyone
// holding `<module>.manage_permission_groups` — writing here directly. No module has one yet;
// opening this screen (or a module's own scoped equivalent) to non-Admins is a later decision.

export async function createPermissionGroup(formData: FormData) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const module_ = String(formData.get("module") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!module_ || !name) throw new Error("Module and Name are required.");

  const { data: group, error } = await supabase
    .from("permission_groups")
    .insert({ module: module_, name, description, created_by: personId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "CREATED",
    details: `Created permission group '${name}' in module '${module_}'`,
  });

  revalidatePath(PATH);
  redirect(`${PATH}?group=${group.id}`);
}

export async function renamePermissionGroup(formData: FormData) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!id || !name) throw new Error("Name is required.");

  const { data: group } = await supabase
    .from("permission_groups")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!group) throw new Error("Permission group not found.");

  const { error } = await supabase
    .from("permission_groups")
    .update({ name, description })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Renamed permission group '${group.name}' to '${name}'`,
  });

  revalidatePath(PATH);
}

export async function deletePermissionGroup(id: string) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const { data: group } = await supabase
    .from("permission_groups")
    .select("module, name")
    .eq("id", id)
    .maybeSingle();
  if (!group) throw new Error("Permission group not found.");

  const { error } = await supabase.from("permission_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "DELETED",
    details: `Deleted permission group '${group.name}' (module '${group.module}')`,
  });

  revalidatePath(PATH);
  revalidatePath("/admin/roles");
  redirect(PATH);
}

// Creates a brand-new raw permission scoped to the group's own module, and immediately adds it
// to this group — the module boundary is enforced twice over (this reads the module off the
// group server-side rather than trusting a client-supplied value, and the DB trigger in
// 0010_permission_groups.sql would reject a mismatch regardless).
export async function addPermissionToGroup(groupId: string, formData: FormData) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const key = String(formData.get("key") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!key) throw new Error("Permission key is required.");

  const { data: group } = await supabase
    .from("permission_groups")
    .select("module, name")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) throw new Error("Permission group not found.");

  const { data: permission, error: permissionError } = await supabase
    .from("permissions")
    .insert({ key, module: group.module, description })
    .select("id")
    .single();
  if (permissionError) throw new Error(permissionError.message);

  const { error: linkError } = await supabase
    .from("permission_group_permissions")
    .insert({ permission_group_id: groupId, permission_id: permission.id });
  if (linkError) throw new Error(linkError.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "CREATED",
    details: `Added new permission '${key}' to group '${group.name}' (module '${group.module}')`,
  });

  revalidatePath(PATH);
}

export async function togglePermissionInGroup(
  groupId: string,
  permissionId: string,
  included: boolean,
) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const { data: group } = await supabase
    .from("permission_groups")
    .select("name")
    .eq("id", groupId)
    .maybeSingle();
  const { data: permission } = await supabase
    .from("permissions")
    .select("key, description")
    .eq("id", permissionId)
    .maybeSingle();

  if (included) {
    const { error } = await supabase
      .from("permission_group_permissions")
      .insert({ permission_group_id: groupId, permission_id: permissionId });
    if (error && error.code !== "23505") throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("permission_group_permissions")
      .delete()
      .eq("permission_group_id", groupId)
      .eq("permission_id", permissionId);
    if (error) throw new Error(error.message);
  }

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `${included ? "Added" : "Removed"} permission '${permission?.description ?? permission?.key ?? permissionId}' ${
      included ? "to" : "from"
    } group '${group?.name ?? groupId}'`,
  });

  revalidatePath(PATH);
}
