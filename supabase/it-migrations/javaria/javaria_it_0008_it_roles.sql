-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     IT Roles & Permissions inside the IT module (/it/admin/roles)
--              (07-it-inventory-plan.md §2.1 "/it/admin/roles: shared, one section per track")
-- Depends on:  talha_it_0001_foundation.sql (it.manage_role_permissions);
--              javaria_it_0005 (it.tickets.read_all); javaria_it_0001/0002 permission rows
-- Applied to live DB: NO
--
-- Why this exists: public.role_permissions is writable only by full admins (is_admin(), i.e.
-- core.full_access — 0019). An IT administrator should be able to decide which roles get which
-- IT permissions without holding the portal-wide admin override. So:
--   * it.set_role_it_permission() lets a holder of it.manage_role_permissions grant / revoke
--     ONLY permissions whose module is 'it' — nothing else in the portal — with an audit-log row.
--   * it.it_roles tags which roles are IT department roles, so the IT screen lists them first;
--     every other role is still reachable there (Employee needs module:it, HR needs
--     it.onboarding.create) but shown under "Other roles".
--   * it.create_it_role() creates a new role and tags it as IT in one step.
-- Roles themselves are shared portal-wide (public.roles); putting people INTO roles stays on
-- Administration → User Management (core) — not duplicated here.
--
-- Seeds five starter IT roles with sensible bundles (editable afterwards on the screen):
--   IT Admin, IT Executive (HQ), HOD IT, IT Site Manager, IT Team Member.
-- Site-manager rights for a specific site still come from it.site_it_staff (role = manager);
-- the "IT Site Manager" role only gives the base access that person needs.

create table it.it_roles (
  role_id uuid primary key references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null
);

alter table it.it_roles enable row level security;

create policy "it_roles readable by authenticated" on it.it_roles
  for select to authenticated using (true);

-- Writes go through the security-definer functions below only.
grant select on it.it_roles to authenticated;

-- ---------------------------------------------------------------------------
-- Grant / revoke one IT permission on one role.
-- ---------------------------------------------------------------------------

create function it.set_role_it_permission(p_role_id uuid, p_permission_id uuid, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perm permissions%rowtype;
  v_role_name text;
  v_actor uuid := current_person_id();
begin
  if not has_permission('it.manage_role_permissions') then
    raise exception 'You need IT Role Permissions (it.manage_role_permissions) to change IT access';
  end if;

  select * into v_perm from permissions where id = p_permission_id;
  if not found or v_perm.module <> 'it' then
    raise exception 'Only IT permissions can be changed here';
  end if;

  select name into v_role_name from roles where id = p_role_id;
  if v_role_name is null then
    raise exception 'Role not found';
  end if;

  if p_granted then
    insert into role_permissions (role_id, permission_id, granted_by)
    values (p_role_id, p_permission_id, v_actor)
    on conflict (role_id, permission_id) do nothing;
  else
    -- Never strand the IT module without anyone able to manage its permissions.
    if v_perm.key = 'it.manage_role_permissions' and not exists (
      select 1 from role_permissions
      where permission_id = p_permission_id and role_id <> p_role_id
    ) then
      raise exception 'Cannot revoke IT Role Permissions from %: it is the last role that has it', v_role_name;
    end if;
    delete from role_permissions where role_id = p_role_id and permission_id = p_permission_id;
  end if;

  insert into audit_log (actor_id, actor_label, module, action, details)
  values (
    v_actor,
    coalesce((select full_name from persons where id = v_actor), 'Unknown'),
    'it',
    'MODIFIED',
    format('Changed ''%s'' IT permissions: %s %s',
           v_role_name, coalesce(v_perm.label, v_perm.key),
           case when p_granted then 'enabled' else 'disabled' end)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a new IT department role (and tag it).
-- ---------------------------------------------------------------------------

create function it.create_it_role(p_name text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_actor uuid := current_person_id();
begin
  if not has_permission('it.manage_role_permissions') then
    raise exception 'You need IT Role Permissions (it.manage_role_permissions) to create IT roles';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Role name is required';
  end if;
  if exists (select 1 from roles where lower(name) = lower(trim(p_name))) then
    raise exception 'A role called "%" already exists', trim(p_name);
  end if;

  insert into roles (name, description, is_system_role)
  values (trim(p_name), nullif(trim(p_description), ''), false)
  returning id into v_role_id;

  insert into it.it_roles (role_id, created_by) values (v_role_id, v_actor);

  insert into audit_log (actor_id, actor_label, module, action, details)
  values (v_actor, coalesce((select full_name from persons where id = v_actor), 'Unknown'),
          'it', 'CREATED', format('Created IT role ''%s''', trim(p_name)));
  return v_role_id;
end;
$$;

-- Tag / untag an existing role as an IT department role (e.g. one an Admin created on
-- /admin/roles). Doesn't change any permissions.
create function it.set_it_role_tag(p_role_id uuid, p_is_it boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('it.manage_role_permissions') then
    raise exception 'You need IT Role Permissions (it.manage_role_permissions)';
  end if;
  if p_is_it then
    insert into it.it_roles (role_id, created_by) values (p_role_id, current_person_id())
    on conflict (role_id) do nothing;
  else
    delete from it.it_roles where role_id = p_role_id;
  end if;
end;
$$;

revoke all on function it.set_role_it_permission(uuid, uuid, boolean) from public;
revoke all on function it.create_it_role(text, text) from public;
revoke all on function it.set_it_role_tag(uuid, boolean) from public;
grant execute on function it.set_role_it_permission(uuid, uuid, boolean) to authenticated;
grant execute on function it.create_it_role(text, text) to authenticated;
grant execute on function it.set_it_role_tag(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the starter IT roles (only if a role of that name doesn't exist yet).
-- ---------------------------------------------------------------------------

insert into roles (name, description, is_system_role) values
  ('IT Admin', 'Configures the IT module: ticket settings, sites & IT staff, category owners, IT role permissions', false),
  ('IT Executive (HQ)', 'HQ IT: sees every site''s tickets, assigns, prioritises, escalates, closes; runs onboarding / offboarding', false),
  ('HOD IT', 'Head of IT: oversight of all sites and final sign-off of offboarding', false),
  ('IT Site Manager', 'Runs a plant''s IT desk: assigns within the site (site set on Sites & IT Staff)', false),
  ('IT Team Member', 'Works tickets and onboarding / offboarding tasks assigned to them', false)
on conflict (name) do nothing;

insert into it.it_roles (role_id)
select id from roles
where name in ('IT Admin', 'IT Executive (HQ)', 'HOD IT', 'IT Site Manager', 'IT Team Member')
on conflict (role_id) do nothing;

-- Permission bundles. IT Admin gets every IT permission (both tracks); the others get the
-- service-management / onboarding set for their job. Talha's inventory permissions are left
-- for the inventory track to bundle (only IT Admin gets them here).
insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
from roles r
join permissions p on (
     (r.name = 'IT Admin' and p.module = 'it')
  or (r.name = 'IT Executive (HQ)' and p.key in (
        'module:it', 'it.tickets.read', 'it.tickets.update', 'it.tickets.assign',
        'it.tickets.close', 'it.tickets.read_all',
        'it.onboarding.read', 'it.onboarding.update', 'it.onboarding.assign'))
  or (r.name = 'HOD IT' and p.key in (
        'module:it', 'it.tickets.read', 'it.tickets.read_all', 'it.tickets.close',
        'it.onboarding.read', 'it.onboarding.approve'))
  or (r.name = 'IT Site Manager' and p.key in (
        'module:it', 'it.tickets.read', 'it.tickets.update',
        'it.onboarding.read', 'it.onboarding.update'))
  or (r.name = 'IT Team Member' and p.key in (
        'module:it', 'it.tickets.read', 'it.tickets.update',
        'it.onboarding.read', 'it.onboarding.update'))
)
where r.name in ('IT Admin', 'IT Executive (HQ)', 'HOD IT', 'IT Site Manager', 'IT Team Member')
on conflict do nothing;
