-- Employee Portal — Authentication & Access Management module (F-01..F-04)
-- Roles, permissions, role_permissions (config-driven RBAC, NFR-09), and profiles
-- (soft-deactivatable, F-04; nullable role_id = pending provisioning state, F-03).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_system_role boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text,
  description text,
  created_at timestamptz not null default now()
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Named "profiles" (not "users") to avoid colliding with Supabase's built-in auth.users table.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role_id uuid references roles(id), -- null = awaiting role assignment (F-03 pending state)
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')), -- F-04
  department text,
  site text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Future (out of scope this pass, per NFR-10): an audit_log table
--   (id, actor_id references profiles(id), action, target_table, target_id, before jsonb,
--    after jsonb, created_at) will record admin mutations to profiles/role_permissions once
--   the admin module (F-59/F-60/F-62) is built.

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger roles_set_updated_at
  before update on roles
  for each row execute function set_updated_at();

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table profiles enable row level security;

-- Reference data: any authenticated user can read roles/permissions/role_permissions (needed by
-- the proxy's permission checks). No write policies yet — TODO(admin module): add admin-only
-- insert/update/delete policies once an "is this caller an Admin" check exists.
create policy "roles readable by authenticated" on roles
  for select to authenticated using (true);

create policy "permissions readable by authenticated" on permissions
  for select to authenticated using (true);

create policy "role_permissions readable by authenticated" on role_permissions
  for select to authenticated using (true);

-- profiles: a user may only read their own row. No insert/update/delete policy for regular
-- users — the first-login insert is performed by app/auth/callback/route.ts using the
-- service-role client (lib/supabase/admin.ts), which bypasses RLS.
-- TODO(admin module): add admin-only insert/update/delete policies for user management (F-59).
create policy "profiles readable by owner" on profiles
  for select to authenticated using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Seed data — baseline roles and route-level permissions
-- ---------------------------------------------------------------------------

insert into roles (name, is_system_role, description) values
  ('Employee', true, 'Baseline employee access'),
  ('HR', true, 'Human Resources'),
  ('IT', true, 'IT department'),
  ('Admin', true, 'Admin/Management — full access');

insert into permissions (key, module, description) values
  ('route:/home', 'employee', 'Access employee home'),
  ('route:/hr/dashboard', 'hr', 'Access HR dashboard'),
  ('route:/it/dashboard', 'it', 'Access IT dashboard'),
  ('route:/admin/users', 'admin', 'Access admin user management');

-- Wire each role to its own route; Admin gets all four. Adding a 5th custom role later is a
-- data change (insert into roles + role_permissions), not a code change.
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where (r.name = 'Employee' and p.key = 'route:/home')
   or (r.name = 'HR' and p.key = 'route:/hr/dashboard')
   or (r.name = 'IT' and p.key = 'route:/it/dashboard')
   or (r.name = 'Admin' and p.key in (
         'route:/home', 'route:/hr/dashboard', 'route:/it/dashboard', 'route:/admin/users'
       ));
