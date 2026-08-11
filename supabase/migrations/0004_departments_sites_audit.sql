-- Employee Portal — Departments/Sites master data (SCR-35, F-61) + real Audit Log (SCR-36, F-62).
-- Purely additive: no changes to any table, policy, or function from 0001-0003.

-- ---------------------------------------------------------------------------
-- org_units: one shared table backing BOTH /admin/departments and /admin/sites, discriminated
-- by `type`. profiles.department/site remain plain TEXT, unchanged — this table only supplies
-- the names the admin user-form's <select> is populated from; no DB-level FK to profiles.
-- ---------------------------------------------------------------------------

create table org_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text,
  type text not null check (type in ('Department', 'Site')),
  description text, -- gray subtitle line under the name, e.g. "Primary Assembly Plant"
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger org_units_set_updated_at
  before update on org_units
  for each row execute function set_updated_at();

alter table org_units enable row level security;

-- Admin-only, both directions — same "for all" shape as 0002's "invited_users admin access"
-- policy. No screen outside the admin module reads org_units this pass.
create policy "org_units admin access" on org_units
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_log (F-62). Insert-only from admin-gated Server Actions; the app never updates or
-- deletes a row once written — that's what makes it an audit trail.
-- ---------------------------------------------------------------------------

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_label text not null, -- denormalized "{display_name} (Admin)" — survives actor deletion
  module text not null,
  action text not null check (action in ('CREATED', 'MODIFIED', 'DELETED', 'SYNCED')),
  details text not null, -- human-readable "before → after" summary
  created_at timestamptz not null default now()
);
-- 'SYNCED' is reserved for a possible future automated-sync feature that does NOT exist in this
-- codebase — no app code in this pass ever inserts action = 'SYNCED'.

create index audit_log_created_at_idx on audit_log (created_at desc);

alter table audit_log enable row level security;

create policy "audit_log admin select" on audit_log
  for select to authenticated using (is_admin(auth.uid()));

create policy "audit_log admin insert" on audit_log
  for insert to authenticated with check (is_admin(auth.uid()));

-- No update/delete policy at all: RLS default-denies any command with no matching policy —
-- this is what makes the log genuinely append-only.

-- ---------------------------------------------------------------------------
-- New route permissions (admin module), granted to Admin only — same pattern as 0002's
-- route:/admin/roles seed.
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('route:/admin/departments', 'admin', 'Access department management'),
  ('route:/admin/sites', 'admin', 'Access site management'),
  ('route:/admin/audit-log', 'admin', 'Access audit log');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.name = 'Admin'
  and p.key in ('route:/admin/departments', 'route:/admin/sites', 'route:/admin/audit-log');
