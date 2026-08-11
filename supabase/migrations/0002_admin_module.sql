-- Employee Portal — System Administration module (F-59/F-60), SCR-33/SCR-34.
-- Resolves the -- TODO(admin module) markers in 0001_init_auth.sql.
-- Deliberately NOT adding write policies to roles/permissions: no UI in this pass creates or
-- edits role/permission *definitions* — only role_permissions grants against the existing
-- seeded set. Revisit if a future pass adds custom-role creation.

-- ---------------------------------------------------------------------------
-- is_admin(): security-definer helper, avoids RLS self-recursion on profiles.
--
-- A normal (security invoker) policy on `profiles` that re-queries `profiles` to check the
-- caller's own role would re-trigger profiles' own RLS policies for that inner query, causing
-- "infinite recursion detected in policy for relation profiles". A security definer function
-- runs with the privileges of its owner (bypasses RLS), so the inner lookup never re-evaluates
-- profiles' policies.
-- ---------------------------------------------------------------------------

create function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from profiles p
    join roles r on r.id = p.role_id
    where p.id = uid
      and r.name = 'Admin'
      and p.status = 'Active'
  );
$$;

revoke all on function is_admin(uuid) from public;
grant execute on function is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: admin-scoped write access (resolves TODO) + new columns
-- ---------------------------------------------------------------------------

alter table profiles
  add column notes text,
  add column last_login_at timestamptz;

-- Permissive policies for the same command are OR'd together, so this adds to (not replaces)
-- "profiles readable by owner".
create policy "profiles select by admin" on profiles
  for select to authenticated
  using (is_admin(auth.uid()));

create policy "profiles insert by admin" on profiles
  for insert to authenticated
  with check (is_admin(auth.uid()));

create policy "profiles update by admin" on profiles
  for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- No delete policy: F-04 is soft-deactivation only (status = 'Inactive'/'Suspended'). Hard
-- delete of a profile is not a supported operation in this module.

-- ---------------------------------------------------------------------------
-- role_permissions: admin-scoped grant/revoke + narrow audit columns
-- (not the full future audit_log table — just who/when granted this specific row, per SCR-34)
-- ---------------------------------------------------------------------------

alter table role_permissions
  add column granted_by uuid references profiles(id) on delete set null default auth.uid(),
  add column granted_at timestamptz default now();

-- The 4 seed rows from 0001 get granted_by = NULL (no auth.uid() in migration context) and
-- granted_at = this migration's apply time. NULL granted_by is the intentional signal for
-- "system-seeded, not attributable to an admin action" — shown as "System default" in the UI.

create policy "role_permissions insert by admin" on role_permissions
  for insert to authenticated
  with check (is_admin(auth.uid()));

create policy "role_permissions delete by admin" on role_permissions
  for delete to authenticated
  using (is_admin(auth.uid()));

-- No update policy: a grant is either inserted (create) or deleted (revoke). Re-granting after a
-- revoke is a fresh insert, which naturally refreshes granted_by/granted_at via the defaults
-- above — no row is ever updated in place, so there's nothing to timestamp on revoke.

-- ---------------------------------------------------------------------------
-- invited_users: pre-provisioning staging table (F-03)
-- ---------------------------------------------------------------------------

create table invited_users (
  email text primary key, -- always stored lowercased+trimmed by app code
  display_name text,
  role_id uuid not null references roles(id),
  department text,
  site text,
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  notes text,
  invited_by uuid references profiles(id) on delete set null default auth.uid(),
  invited_at timestamptz not null default now()
);

alter table invited_users enable row level security;

create policy "invited_users admin access" on invited_users
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- Not readable/writable by anyone except an Admin (including the invitee themselves before
-- first login) — app/auth/callback/route.ts reads and consumes invitations via the service-role
-- client (lib/supabase/admin.ts), same pattern already used for the first-profile insert, so RLS
-- here only needs to gate the admin UI's direct access.

-- ---------------------------------------------------------------------------
-- New permission for SCR-34, granted to Admin only
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('route:/admin/roles', 'admin', 'Access role & permission management');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.name = 'Admin' and p.key = 'route:/admin/roles';
