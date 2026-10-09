import "server-only";
import { createClient } from "@/lib/supabase/server";

// Defense-in-depth for every Server Action in this codebase — proxy.ts already blocks the page
// by route, but Server Actions are independently POST-reachable. Checks the same has_permission()
// SQL function (0010_permission_groups.sql) the proxy itself uses, so a duplicated or brand-new
// custom role (see admin/roles/actions.ts's duplicateRole note) gets correct action-level access
// too, not just page visibility — there is no role-name check anywhere in this app anymore.
export async function requirePermission(permissionKey: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: account } = await supabase
    .from("user_accounts")
    .select("person_id, status, persons(full_name, personal_email, status)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!account || account.status !== "Active" || account.persons?.status !== "Active") {
    throw new Error("Forbidden");
  }

  const { data: granted } = await supabase.rpc("has_permission", {
    p_permission_key: permissionKey,
  });
  if (!granted) throw new Error(`Forbidden: '${permissionKey}' permission required`);

  const actorLabel = account.persons?.full_name ?? account.persons?.personal_email ?? "Unknown";
  return { supabase, personId: account.person_id as string, actorLabel };
}
