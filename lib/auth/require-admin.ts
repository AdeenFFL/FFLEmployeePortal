import "server-only";
import { createClient } from "@/lib/supabase/server";

// Re-verifies the caller is an active Admin, server-side, before a Server Action mutates
// anything. Defense in depth: proxy.ts already gates /admin/* by route, but Server Actions are
// independently POST-reachable regardless of which page rendered the form.
export async function requireAdmin() {
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
    throw new Error("Forbidden: Admin role required");
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("person_id", account.person_id);

  const roleNames = (roleRows ?? []).map((r) => r.roles?.name).filter(Boolean);
  if (!roleNames.includes("Admin")) {
    throw new Error("Forbidden: Admin role required");
  }

  const actorLabel = `${account.persons?.full_name ?? account.persons?.personal_email} (Admin)`;
  return { supabase, personId: account.person_id as string, actorLabel };
}
