"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { applyRolePermissionChanges } from "@/lib/admin/role-permissions";

const PATH = "/it/admin/roles";
const MANAGE_KEY = "it.manage_role_permissions";

// Fixed result codes — the URL never carries free text. page.tsx maps each code to its own
// fixed message; an unknown code shows nothing.
export type ItRolesErrorCode = "db-refused" | "partial" | "last-holder" | "bad-key";

// `t` changes on every redirect so page.tsx remounts the editor from what's really in the
// database, instead of keeping the toggles the user tried to save.
function fail(roleId: string, code: ItRolesErrorCode): never {
  redirect(
    `${PATH}?role=${encodeURIComponent(roleId)}&error=${code}&t=${Date.now()}`,
  );
}

// IT's own scoped entrypoint, same pattern as hr/admin/roles/actions.ts: gated by
// it.manage_role_permissions (not route:/admin/roles) and restricted to it.* permissions, since
// this Server Action is POST-reachable no matter which page rendered the form.
//
// The database (0019) only lets core.full_access holders write role_permissions, and a revoke by
// anyone else silently deletes nothing. So after saving, the role's grants are re-read and
// compared with what was asked for — "saved" is only reported when the database really changed.
export async function saveItRolePermissions(
  roleId: string,
  changes: { permissionId: string; granted: boolean }[],
) {
  const { supabase, personId, actorLabel } = await requirePermission(MANAGE_KEY);
  if (changes.length === 0) return;

  // 1. Only it.* keys. That also excludes module:it, core.*, hr.*, route:* and unknown ids.
  const { data: permissions } = await supabase
    .from("permissions")
    .select("id, key")
    .in(
      "id",
      changes.map((c) => c.permissionId),
    );
  const keyById = new Map((permissions ?? []).map((p) => [p.id, p.key]));
  if (
    keyById.size !== new Set(changes.map((c) => c.permissionId)).size ||
    [...keyById.values()].some((key) => !key.startsWith("it."))
  ) {
    fail(roleId, "bad-key");
  }

  // 2. Never leave nobody holding it.manage_role_permissions (the shared helper only protects
  //    route:/admin/users, route:/admin/roles and core.full_access).
  const manageRevoke = changes.find(
    (c) => !c.granted && keyById.get(c.permissionId) === MANAGE_KEY,
  );
  if (manageRevoke) {
    const { data: holders } = await supabase
      .from("role_permissions")
      .select("role_id")
      .eq("permission_id", manageRevoke.permissionId);
    const remaining = (holders ?? []).filter((h) => h.role_id !== roleId);
    if (remaining.length === 0) fail(roleId, "last-holder");
  }

  // 3. Apply through the shared helper. A refused grant throws (RLS); catch it and let the
  //    re-check below decide what to report — the database is the only source of truth.
  try {
    await applyRolePermissionChanges({
      supabase,
      personId,
      actorLabel,
      roleId,
      changes,
      revalidatePaths: [PATH],
    });
  } catch {
    // reported via the re-check
  }

  // 4. Re-read and compare: did every requested change actually land?
  const { data: after, error: readError } = await supabase
    .from("role_permissions")
    .select("permission_id")
    .eq("role_id", roleId);
  if (readError) fail(roleId, "db-refused");
  const grantedNow = new Set((after ?? []).map((g) => g.permission_id));
  const landed = changes.filter((c) => grantedNow.has(c.permissionId) === c.granted).length;

  if (landed === changes.length) return;
  if (landed === 0) fail(roleId, "db-refused");
  fail(roleId, "partial");
}
