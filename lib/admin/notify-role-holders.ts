import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Tells everyone holding a role that its permissions changed (javaria_it_0026). Best effort: the
// permissions are already saved, so a failed notification returns 0 rather than failing the save.
export async function notifyRoleHolders(
  supabase: SupabaseClient<Database>,
  roleId: string,
  changes: { label: string; granted: boolean }[],
) {
  if (changes.length === 0) return 0;
  const summary = changes.map((c) => `${c.label} ${c.granted ? "turned on" : "turned off"}`).join("; ");
  const { data, error } = await supabase.rpc("notify_role_access_changed", { p_role_id: roleId, p_summary: summary });
  if (error) console.error("notify_role_access_changed failed:", error.message);
  return error ? 0 : (data ?? 0);
}
