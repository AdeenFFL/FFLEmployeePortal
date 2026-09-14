-- Employee Portal — Permission groups: the module-scoped bundling layer between raw
-- `permissions` and `roles`. Decision (context.md): roles are now composed ONLY of permission
-- groups — no more direct role_permissions grants. A permission group is created within one
-- module (by a portal Admin today; by a "module admin" — anyone holding
-- `<module>.manage_permission_groups` — once a module actually has one) and bundles whichever
-- raw permissions belong together. Roles combine groups, possibly from multiple modules.
--
--   permissions --(M:N)--> permission_groups --(M:N)--> roles --(user_roles, already
--   (module-scoped)                                            company/site-scoped)--> persons

-- ---------------------------------------------------------------------------
-- 1. permission_groups
-- ---------------------------------------------------------------------------

create table permission_groups (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  name text not null,
  description text,
  created_by uuid references persons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module, name)
);

create trigger permission_groups_set_updated_at
  before update on permission_groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. permission_group_permissions — which raw permissions a group bundles. Trigger-enforced: a
--    group can only contain permissions from its own module (closes the privilege-escalation
--    path where a module admin's group quietly pulls in another module's permission).
-- ---------------------------------------------------------------------------

create table permission_group_permissions (
  permission_group_id uuid not null references permission_groups(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (permission_group_id, permission_id)
);

create function enforce_permission_group_module_match()
returns trigger as $$
declare
  v_group_module text;
  v_permission_module text;
begin
  select module into v_group_module from permission_groups where id = new.permission_group_id;
  select module into v_permission_module from permissions where id = new.permission_id;
  if v_group_module is distinct from v_permission_module then
    raise exception 'Permission belongs to module %, but the group belongs to module % — a group can only contain permissions from its own module.',
      v_permission_module, v_group_module;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_permission_group_module_match
  before insert or update on permission_group_permissions
  for each row execute function enforce_permission_group_module_match();

-- ---------------------------------------------------------------------------
-- 3. role_permission_groups — replaces role_permissions. Assigning a group to a role stays an
--    Admin-only decision (a role is portal-wide, e.g. "Plant Manager", and can combine groups
--    from several modules) even though module admins own the groups themselves. No DEFAULT on
--    granted_by (unlike the old role_permissions.granted_by default auth.uid(), which was wrong
--    after the persons/user_accounts split — auth.uid() is not persons.id); callers must pass it.
-- ---------------------------------------------------------------------------

create table role_permission_groups (
  role_id uuid not null references roles(id) on delete cascade,
  permission_group_id uuid not null references permission_groups(id) on delete cascade,
  granted_by uuid references persons(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_group_id)
);

-- ---------------------------------------------------------------------------
-- 4. has_permission(key) — the one function every module's route-gating/RLS should call from
--    here on, per 01-platform-design-and-sop.md Section 6. Mirrors current_person_id()'s
--    security-definer shape.
-- ---------------------------------------------------------------------------

create function has_permission(p_permission_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_roles ur
    join role_permission_groups rpg on rpg.role_id = ur.role_id
    join permission_group_permissions pgp on pgp.permission_group_id = rpg.permission_group_id
    join permissions p on p.id = pgp.permission_id
    where ur.person_id = current_person_id()
      and p.key = p_permission_key
  );
$$;

revoke all on function has_permission(text) from public;
grant execute on function has_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill: one single-permission group per existing permission (named after its key), so
--    every current role_permissions grant has an equivalent group-mediated grant. Admins can
--    consolidate these into more meaningful multi-permission groups later via the new UI — this
--    backfill only guarantees nothing breaks on cutover.
-- ---------------------------------------------------------------------------

insert into permission_groups (module, name, description)
select coalesce(module, 'core'), key, description
from permissions
on conflict (module, name) do nothing;

insert into permission_group_permissions (permission_group_id, permission_id)
select pg.id, p.id
from permissions p
join permission_groups pg on pg.module = coalesce(p.module, 'core') and pg.name = p.key;

insert into role_permission_groups (role_id, permission_group_id, granted_by, granted_at)
select rp.role_id, pg.id, rp.granted_by, coalesce(rp.granted_at, now())
from role_permissions rp
join permissions p on p.id = rp.permission_id
join permission_groups pg on pg.module = coalesce(p.module, 'core') and pg.name = p.key
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Drop role_permissions — superseded. Nothing reads it once this migration ships alongside
--    the app-code changes (admin/roles UI + proxy.ts now go through permission_groups).
-- ---------------------------------------------------------------------------

drop table role_permissions;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

alter table permission_groups enable row level security;
alter table permission_group_permissions enable row level security;
alter table role_permission_groups enable row level security;

create policy "permission_groups readable by authenticated" on permission_groups
  for select to authenticated using (true);

create policy "permission_groups write by admin or module admin" on permission_groups
  for all to authenticated
  using (is_admin(auth.uid()) or has_permission(module || '.manage_permission_groups'))
  with check (is_admin(auth.uid()) or has_permission(module || '.manage_permission_groups'));

create policy "permission_group_permissions readable by authenticated" on permission_group_permissions
  for select to authenticated using (true);

create policy "permission_group_permissions write by admin or module admin" on permission_group_permissions
  for all to authenticated
  using (
    is_admin(auth.uid())
    or has_permission((select module from permission_groups where id = permission_group_id) || '.manage_permission_groups')
  )
  with check (
    is_admin(auth.uid())
    or has_permission((select module from permission_groups where id = permission_group_id) || '.manage_permission_groups')
  );

create policy "role_permission_groups readable by authenticated" on role_permission_groups
  for select to authenticated using (true);

create policy "role_permission_groups admin write" on role_permission_groups
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. permissions: extend write access to module admins (was admin-only in practice — no write
--    policy existed at all before this migration, so RLS default-denied every write; only a
--    service-role/SQL-editor insert worked). Module admins may only write permissions tagged
--    with their own module.
-- ---------------------------------------------------------------------------

create policy "permissions write by admin or module admin" on permissions
  for all to authenticated
  using (is_admin(auth.uid()) or (module is not null and has_permission(module || '.manage_permission_groups')))
  with check (is_admin(auth.uid()) or (module is not null and has_permission(module || '.manage_permission_groups')));

-- ---------------------------------------------------------------------------
-- 9. roles: fixes a pre-existing gap — admin/roles/actions.ts already creates/renames/deletes
--    roles (duplicateRole/renameRole/deleteRole), but no write policy ever existed for `roles`,
--    so those actions would fail under RLS. Admin-only, matching how the admin UI already gates
--    these actions via requireAdmin().
-- ---------------------------------------------------------------------------

create policy "roles insert by admin" on roles
  for insert to authenticated with check (is_admin(auth.uid()));

create policy "roles update by admin" on roles
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy "roles delete by admin" on roles
  for delete to authenticated using (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. New route permission for the permission-groups admin screen, granted to Admin only
--     (module-admin self-service to a scoped UI is a later, per-module decision — the policies
--     above already support it at the data layer whenever that happens).
-- ---------------------------------------------------------------------------

insert into permission_groups (module, name, description) values
  ('admin', 'Manage Permission Groups', 'Access the permission-groups admin screen');

insert into permissions (key, module, description) values
  ('route:/admin/permission-groups', 'admin', 'Access permission-groups management');

insert into permission_group_permissions (permission_group_id, permission_id)
select pg.id, p.id
from permission_groups pg, permissions p
where pg.module = 'admin' and pg.name = 'Manage Permission Groups'
  and p.key = 'route:/admin/permission-groups';

insert into role_permission_groups (role_id, permission_group_id)
select r.id, pg.id
from roles r, permission_groups pg
where r.name = 'Admin' and pg.module = 'admin' and pg.name = 'Manage Permission Groups';
