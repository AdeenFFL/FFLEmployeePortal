import "server-only";
import { createClient } from "@/lib/supabase/server";

// Defense-in-depth for /profile Server Actions, same rationale as requirePermission(): proxy.ts
// already gates /profile by route, but Server Actions are independently POST-reachable.
// Unlike requirePermission, no permission check — any active, authenticated person qualifies
// (every role has /profile access).
//
// Returns BOTH ids, and callers must not mix them up: `personId` is the FK value to write into
// any `person_id` column. `authUserId` is the raw Supabase auth id — any storage bucket policy
// that checks `(storage.foldername(name))[1] = auth.uid()` needs a path built from
// `authUserId`, not `personId`. No current feature uploads to storage (kept for the next module
// that does — see the git history of profile/actions.ts pre-strip for the original pattern).
export async function requireActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: account } = await supabase
    .from("user_accounts")
    .select("person_id, status, persons(status)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!account || account.status !== "Active" || account.persons?.status !== "Active") {
    throw new Error("Forbidden");
  }

  return { supabase, personId: account.person_id as string, authUserId: user.id };
}
