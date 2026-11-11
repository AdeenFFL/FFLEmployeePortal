import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Secret-key client — bypasses Row Level Security. Server-only; never import this into a
// Client Component or expose SUPABASE_SECRET_KEY to the browser bundle.
//
// Narrow, justified uses:
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
//   5. createLifecycleRequest also inserts one checklist_items row per requested access
//      (splitting the "access required" field) right after creating the request — same
//      write-permission gap as use 3, same same-request system default reasoning.
//   6. completeHandoverTask reads it.asset_assignments.acknowledged_at to confirm a handover —
//      that table needs it.assets.read or being the asset's holder, neither of which an IT
//      Executive working onboarding (it.onboarding.assign) necessarily has.
//   7. assignRoleForOnboardingTask writes user_roles directly (admin-only under RLS) or updates
//      a staged invited_users row's role_id (readable/writable only by is_admin() under RLS) —
//      same it.onboarding.assign-is-the-real-boundary reasoning as uses 4 and 6.
//   8. createLifecycleRequest also auto-provisions a real portal account (createUser,
//      persons/user_accounts/user_roles inserts, generateLink) when onboarding doesn't require a
//      company email — same password-account sequence as admin/users' (use 2), triggered by the
//      HR requester's own it.onboarding.create permission instead of route:/admin/users.
//   9. The same action stages an invited_users row (Microsoft path) — invited_users is
//      is_admin()-only under RLS, same reasoning as use 7.
//  10. createLifecycleRequest also looks up the chosen reporting manager's name (for the
//      denormalized display column) once a person is picked via the lookup field — persons is
//      admin-only under RLS for anyone but themselves, same reasoning as uses 4 and 6.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
