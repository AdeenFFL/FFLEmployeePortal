-- Employee Portal — two changes, same root cause (hardcoded role names), done together since
-- this migration already touches the exact tables both live in:
--
-- 1. Collapses permission_groups / permission_group_permissions / role_permission_groups into
--    one direct role_permissions(role_id, permission_id) table. Confirmed live: zero existing
--    groups bundle more than one permission — the "group" layer was pure indirection nobody
--    ever used for actual grouping, and its name was actively misleading (a user reading
--    "Permission Groups" reasonably expects bundling, there wasn't any). permissions ->
--    role_permissions -> roles is the honest model of what this has always been.
--
-- 2. is_admin(uid) — used across ~25 RLS policies (persons, companies, org_units, roles,
--    permissions, audit_log, the old permission_groups chain) — has checked `r.name = 'Admin'`
--    literally since 0002_admin_module.sql. That's the same hardcoded-role-name problem already
--    removed from every app-layer check (requirePermission, see lib/auth/require-permission.ts's
--    header comment) — a custom role could be granted every fine-grained route:/admin/*
--    permission in the app and still get silently blocked by RLS on the underlying tables,
--    because none of that matched "named Admin". Redefined to check a real permission,
--    core.full_access, instead — granted to the existing Admin role here so current behavior is
--    unchanged, but now any role can be given the same capability deliberately.

-- ---------------------------------------------------------------------------
-- Part 1 — role_permissions, backfilled 1:1 from the old chain (safe: no group ever had more
-- than one member, confirmed before writing this migration).
-- ---------------------------------------------------------------------------

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  granted_by uuid references persons(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

insert into role_permissions (role_id, permission_id, granted_by, granted_at)
select rpg.role_id, pgp.permission_id, rpg.granted_by, rpg.granted_at
from role_permission_groups rpg
join permission_group_permissions pgp on pgp.permission_group_id = rpg.permission_group_id
on conflict do nothing;

alter table role_permissions enable row level security;

create policy "role_permissions readable by authenticated" on role_permissions
  for select to authenticated using (true);

create policy "role_permissions write by admin" on role_permissions
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Part 2 — has_permission(key): same signature, now reads role_permissions directly instead of
-- joining through the retired group tables. Every RLS policy and requirePermission() call in
-- the app keeps working unchanged — this is the one choke point that made that possible.
-- ---------------------------------------------------------------------------

create or replace function has_permission(p_permission_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where ur.person_id = current_person_id()
      and p.key = p_permission_key
  );
$$;

-- ---------------------------------------------------------------------------
-- Part 3 — core.full_access: the new, real permission is_admin() checks. Granted to the
-- existing Admin role so nothing changes for anyone today; from here on it's just another
-- permission any role can be given, the same as module:hr or hr.tickets.delete.
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('core.full_access', 'core', 'Full administrative override — bypasses every fine-grained permission check at the database level (persons, companies, org units, roles, permissions, audit log). Equivalent to the old hardcoded "named Admin" check; grant deliberately.')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null
from roles r, permissions p
where r.name = 'Admin' and p.key = 'core.full_access'
on conflict do nothing;

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_accounts ua
    join user_roles ur on ur.person_id = ua.person_id
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where ua.auth_user_id = uid
      and ua.status = 'Active'
      and p.key = 'core.full_access'
  );
$$;

-- ---------------------------------------------------------------------------
-- Part 4 — retire the old chain. Drops cascade their own triggers/policies; the standalone
-- trigger function (no longer attached to anything) is dropped explicitly.
-- ---------------------------------------------------------------------------

drop table role_permission_groups;
drop table permission_group_permissions;
drop table permission_groups;
drop function if exists enforce_permission_group_module_match();
