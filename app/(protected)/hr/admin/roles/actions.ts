"use server";

import { requirePermission } from "@/lib/auth/require-permission";
import { applyRolePermissionGroupChanges } from "@/lib/admin/role-permission-groups";

// HR's own scoped entrypoint — gated by hr.manage_role_permissions, not the global
// route:/admin/roles, so configuring HR's permissions doesn't require full Roles & Permissions
// access. Restricted to HR's own permission groups only: this Server Action is independently
// POST-reachable regardless of which page rendered the form, so someone granted only
// hr.manage_role_permissions must not be able to use it to touch an unrelated (e.g. admin/*)
// permission group just because they know its id.
export async function saveHrRolePermissionGroups(
  roleId: string,
  changes: { permissionGroupId: string; granted: boolean }[],
) {
  const { supabase, personId, actorLabel } = await requirePermission("hr.manage_role_permissions");
  if (changes.length === 0) return;

  const { data: groups } = await supabase
    .from("permission_groups")
    .select("id, module")
    .in(
      "id",
      changes.map((c) => c.permissionGroupId),
    );
  const nonHrGroup = (groups ?? []).some((g) => g.module !== "hr");
  if (nonHrGroup || (groups?.length ?? 0) !== changes.length) {
    throw new Error("This action can only change HR's own permissions.");
  }

  await applyRolePermissionGroupChanges({
    supabase,
    personId,
    actorLabel,
    roleId,
    changes,
    revalidatePaths: ["/hr/admin/roles"],
  });
}
