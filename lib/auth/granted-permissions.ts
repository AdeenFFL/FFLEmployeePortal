import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// The one place that resolves "every permission key this person's role(s) currently grant,
// across every permission group" — nothing else in the app should re-derive this by matching
// on a role's *name* (see lib/auth/home-path.ts and components/sidebar's nav-visibility, both
// keyed off this instead of a hardcoded role list). A person can hold more than one role
// (user_roles is multi-role), so this unions grants across all of them.
export async function getGrantedPermissionKeys(
  supabase: SupabaseClient<Database>,
  personId: string,
): Promise<Set<string>> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("person_id", personId);
  const roleIds = [...new Set((roleRows ?? []).map((r) => r.role_id))];
  if (roleIds.length === 0) return new Set();

  const { data: grantRows } = await supabase
    .from("role_permission_groups")
    .select("permission_group_id")
    .in("role_id", roleIds);
  const groupIds = [...new Set((grantRows ?? []).map((g) => g.permission_group_id))];
  if (groupIds.length === 0) return new Set();

  const { data: permissionRows } = await supabase
    .from("permission_group_permissions")
    .select("permissions(key)")
    .in("permission_group_id", groupIds);

  return new Set(
    (permissionRows ?? []).map((p) => p.permissions?.key).filter(Boolean) as string[],
  );
}
