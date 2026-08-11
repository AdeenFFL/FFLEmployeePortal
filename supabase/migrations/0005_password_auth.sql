-- Employee Portal — password-based sign-in, a second independent auth method alongside
-- Microsoft OAuth, decided once per account at creation (no identity-linking between the two).
-- Purely additive: no changes to any table, policy, or function from 0001-0004.

alter table profiles
  add column auth_method text not null default 'microsoft'
    check (auth_method in ('microsoft', 'password'));

-- Every existing row backfills to 'microsoft' via the DEFAULT — correct, every account so far
-- came through the OAuth invite flow.

-- No RLS policy changes: auth.admin.createUser/updateUserById (service-role client) bypass RLS
-- entirely, same as the existing first-profile insert in app/auth/callback/route.ts. A new
-- password account's profiles row is inserted via the acting Admin's own RLS-respecting
-- session, already covered by "profiles insert by admin" (0002). Self-service password change
-- (supabase.auth.updateUser) is handled inside Supabase's own auth.users/GoTrue layer — it
-- never goes through PostgREST or touches any RLS-governed table here.
