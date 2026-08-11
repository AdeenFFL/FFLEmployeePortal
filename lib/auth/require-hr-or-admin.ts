import "server-only";
import { createClient } from "@/lib/supabase/server";

// Re-verifies the caller is an active HR or Admin, server-side, before a Server Action mutates
// anything. Same rationale/shape as requireAdmin() — proxy.ts already gates the page by route,
// but Server Actions are independently POST-reachable regardless of which page rendered the form.
export async function requireHrOrAdmin() {
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
    throw new Error("Forbidden: HR or Admin role required");
  }

  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .maybeSingle();

  if (role?.name !== "HR" && role?.name !== "Admin") {
    throw new Error("Forbidden: HR or Admin role required");
  }

  const actorLabel = `${profile.display_name ?? profile.email} (${role.name})`;
  return { supabase, profileId: profile.id, actorLabel };
}
