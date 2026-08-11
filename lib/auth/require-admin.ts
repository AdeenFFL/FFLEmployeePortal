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

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role_id, status, display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.status !== "Active" || !profile.role_id) {
    throw new Error("Forbidden: Admin role required");
  }

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .maybeSingle();

  if (role?.name !== "Admin") {
    throw new Error("Forbidden: Admin role required");
  }

  const actorLabel = `${profile.display_name ?? profile.email} (Admin)`;
  return { supabase, adminProfileId: profile.id, actorLabel };
}
