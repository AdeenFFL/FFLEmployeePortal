"use server";

import { requirePermission } from "@/lib/auth/require-permission";
import { applyRolePermissionChanges } from "@/lib/admin/role-permissions";

// HR's own scoped entrypoint — gated by hr.manage_role_permissions, not the global
// route:/admin/roles, so configuring HR's permissions doesn't require full Roles & Permissions
// access. Restricted to HR's own permissions only: this Server Action is independently
// POST-reachable regardless of which page rendered the form, so someone granted only
// hr.manage_role_permissions must not be able to use it to grant/revoke unrelated (e.g. admin/*)
// permissions just because it's independently POST-reachable.
export async function saveHrRolePermissions(
  roleId: string,
  changes: { permissionId: string; granted: boolean }[],
) {
  const { supabase, personId, actorLabel } = await requirePermission("hr.manage_role_permissions");
  if (changes.length === 0) return;

  const { data: permissions } = await supabase
    .from("permissions")
    .select("id, module")
    .in(
      "id",
      changes.map((c) => c.permissionId),
    );
  const nonHr = (permissions ?? []).some((p) => p.module !== "hr");
  if (nonHr || (permissions?.length ?? 0) !== changes.length) {
    throw new Error("This action can only change HR's own permissions.");
  }

  await applyRolePermissionChanges({
    supabase,
    personId,
    actorLabel,
    roleId,
    changes,
    revalidatePaths: ["/hr/admin/roles"],
  });
}
