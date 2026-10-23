import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Secret-key client — bypasses Row Level Security. Server-only; never import this into a
// Client Component or expose SUPABASE_SECRET_KEY to the browser bundle.
//
// Two narrow, justified uses:
//   1. app/auth/callback/route.ts inserts a brand-new user's first `persons`/`user_accounts`
//      rows, since a user with no row yet cannot satisfy the self-scoped RLS policies.
//   2. app/(protected)/admin/users/actions.ts calls the Auth Admin API
//      (auth.admin.createUser / updateUserById) to create or reset a password-based account —
//      the only way to set a password without an email round-trip. The actual `persons` /
//      `user_accounts` row inserts for a new password account still go through the acting
//      Admin's own RLS-respecting session, not this client.
//   3. app/(protected)/it/onboarding/actions.ts's createLifecycleRequest pre-fills the
//      auto-created "Email Account" checklist item with a suggested address right after
//      insert — the HR requester's own session usually can't write checklist_items (that
//      needs it.onboarding.assign/update), and this is a same-request system default, not a
//      user-authored edit.
//   4. The same file's deactivatePortalAccess sets persons.status = 'Inactive' when an IT
//      Executive closes out offboarding — persons is admin-only under RLS ("persons update by
//      admin" / "persons select own or admin"), but it.onboarding.assign is the real
//      authorization boundary for this one, narrow, already-permission-checked read+write.
//      app/(protected)/it/onboarding/[id]/page.tsx reads the leaver's current status the same
//      way, to show the right button state.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
