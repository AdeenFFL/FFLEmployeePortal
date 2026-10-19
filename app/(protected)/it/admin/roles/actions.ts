"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

// IT Roles & Permissions (javaria_it_0008_it_roles.sql). Every write goes through security-
// definer functions that only ever touch permissions whose module is 'it', so an IT admin can
// manage IT access without the portal-wide admin override. Checked here too (defense in depth).

const PATH = "/it/admin/roles";

// Called by the shared RolePermissionsEditor; throws so the editor can show the message.
export async function saveItRolePermissions(
  roleId: string,
  changes: { permissionId: string; granted: boolean }[],
) {
  const { supabase } = await requirePermission("it.manage_role_permissions");

  for (const change of changes) {
    const { error } = await supabase.schema("it").rpc("set_role_it_permission", {
      p_role_id: roleId,
      p_permission_id: change.permissionId,
      p_granted: change.granted,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath(PATH);
  revalidatePath("/", "layout"); // sidebar visibility follows permissions
}

export async function createItRole(formData: FormData) {
  const { supabase } = await requirePermission("it.manage_role_permissions");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) redirect(`${PATH}?error=${encodeURIComponent("Role name is required.")}`);

  const { data: roleId, error } = await supabase
    .schema("it")
    .rpc("create_it_role", { p_name: name, p_description: description });
  if (error || !roleId) {
    redirect(`${PATH}?error=${encodeURIComponent(error?.message ?? "Could not create the role.")}`);
  }

  revalidatePath(PATH);
  redirect(
    `${PATH}?role=${roleId}&notice=${encodeURIComponent(`IT role "${name}" created. Switch on its permissions below, then give it to people on User Management.`)}`,
  );
}

export async function setItRoleTag(roleId: string, isIt: boolean) {
  const { supabase } = await requirePermission("it.manage_role_permissions");

  const { error } = await supabase
    .schema("it")
    .rpc("set_it_role_tag", { p_role_id: roleId, p_is_it: isIt });
  if (error) redirect(`${PATH}?role=${roleId}&error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(
    `${PATH}?role=${roleId}&notice=${encodeURIComponent(isIt ? "Marked as an IT role." : "No longer listed as an IT role (its permissions are unchanged).")}`,
  );
}
