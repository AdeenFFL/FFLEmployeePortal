import "server-only";
import { createClient } from "@/lib/supabase/server";

// Defense-in-depth for /profile Server Actions, same rationale as requireAdmin(): proxy.ts
// already gates /profile by route, but Server Actions are independently POST-reachable.
// Unlike requireAdmin, no role check — any active, authenticated profile qualifies (all four
// roles have /profile access).
export async function requireActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.status !== "Active") {
    throw new Error("Forbidden");
  }

  return { supabase, userId: profile.id };
}
