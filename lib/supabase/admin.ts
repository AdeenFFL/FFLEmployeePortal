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
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
