-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Phase 1 — inventory settings: asset types, asset value types, inventory
--              permissions (07-it-inventory-plan.md §3, §5 Phase 1)
-- Depends on:  talha_it_0001_foundation (or Javeria's equivalent: schema usage grant)
-- Applied to live DB: YES (2026-10-13, verified live during reconciliation)
--
-- Brings the two pre-existing inventory tables (see talha_it_0000) up to the portal conventions
-- (SOP §7: audit columns, RLS on every table) without recreating them. The live RLS/policy/trigger
-- state wasn't visible in the baseline capture, so every statement is written to work whether
-- or not it already exists.
--
-- PRE-FLIGHT — run this first. If it returns rows, the depreciation_method check constraint
-- below will fail; fix or map those values before running the migration:
--   select id, name, depreciation_method from it.asset_value_types
--   where depreciation_method not in ('Straight Line', 'Reducing Balance');

-- ---------------------------------------------------------------------------
-- Part 1 — audit columns + updated_at triggers (public.set_updated_at() from 0001).
-- ---------------------------------------------------------------------------

alter table it.asset_types
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.persons(id),
  add column if not exists updated_by uuid references public.persons(id);

alter table it.asset_value_types
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.persons(id),
  add column if not exists updated_by uuid references public.persons(id);

drop trigger if exists asset_types_set_updated_at on it.asset_types;
create trigger asset_types_set_updated_at
  before update on it.asset_types
  for each row execute function public.set_updated_at();

drop trigger if exists asset_value_types_set_updated_at on it.asset_value_types;
create trigger asset_value_types_set_updated_at
  before update on it.asset_value_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Part 2 — constrain depreciation_method to the two methods the valuation function (Phase 6)
-- will implement. Was free text in the baseline.
-- ---------------------------------------------------------------------------

alter table it.asset_value_types
  drop constraint if exists asset_value_types_depreciation_method_check;
alter table it.asset_value_types
  add constraint asset_value_types_depreciation_method_check
  check (depreciation_method in ('Straight Line', 'Reducing Balance'));

-- ---------------------------------------------------------------------------
-- Part 3 — this track's permission keys (per-operation style from 0017; label from 0020).
-- Admin gets all of them, same as 0018 did for HR. Which other roles (e.g. the seeded "IT" role)
-- get what is config for /it/admin/roles, not this migration.
-- ---------------------------------------------------------------------------

insert into permissions (key, module, label, description) values
  ('it.assets.read', 'it', 'View Asset Register', 'View the asset register and asset details'),
  ('it.assets.create', 'it', 'Register Assets', 'Add new assets to the register'),
  ('it.assets.update', 'it', 'Edit Assets', 'Edit asset details and change asset status'),
  ('it.assets.delete', 'it', 'Retire/Delete Assets', 'Soft-delete assets from the register'),
  ('it.assets.assign', 'it', 'Assign/Return Assets', 'Assign assets to employees and record returns'),
  ('it.maintenance.update', 'it', 'Log Repairs', 'Record repair and maintenance activity on assets'),
  ('it.stock.read', 'it', 'View Stock', 'View consumable stock levels and movements'),
  ('it.stock.update', 'it', 'Record Stock Movements', 'Record stock in / stock out movements'),
  ('it.valuation.update', 'it', 'Manage Valuations', 'Record and update asset valuations'),
  ('it.inventory_settings.update', 'it', 'Inventory Settings', 'Manage asset types and asset value types')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null
from roles r, permissions p
where r.name = 'Admin'
  and p.key in (
    'it.assets.read', 'it.assets.create', 'it.assets.update', 'it.assets.delete',
    'it.assets.assign', 'it.maintenance.update', 'it.stock.read', 'it.stock.update',
    'it.valuation.update', 'it.inventory_settings.update'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Part 4 — RLS. Both tables are reference data: readable by any signed-in person (Javeria's
-- product master, ticket forms and the employee-facing My Assets screen all show asset types),
-- writable only with it.inventory_settings.update. Delete is allowed but FK restrict will block
-- it once a type is in use; the UI deactivates (is_active) instead.
-- ---------------------------------------------------------------------------

alter table it.asset_types enable row level security;
alter table it.asset_value_types enable row level security;

drop policy if exists "asset_types readable by authenticated" on it.asset_types;
create policy "asset_types readable by authenticated" on it.asset_types
  for select to authenticated using (true);

drop policy if exists "asset_types insert by inventory admin" on it.asset_types;
create policy "asset_types insert by inventory admin" on it.asset_types
  for insert to authenticated with check (has_permission('it.inventory_settings.update'));

drop policy if exists "asset_types update by inventory admin" on it.asset_types;
create policy "asset_types update by inventory admin" on it.asset_types
  for update to authenticated
  using (has_permission('it.inventory_settings.update'))
  with check (has_permission('it.inventory_settings.update'));

drop policy if exists "asset_types delete by inventory admin" on it.asset_types;
create policy "asset_types delete by inventory admin" on it.asset_types
  for delete to authenticated using (has_permission('it.inventory_settings.update'));

drop policy if exists "asset_value_types readable by authenticated" on it.asset_value_types;
create policy "asset_value_types readable by authenticated" on it.asset_value_types
  for select to authenticated using (true);

drop policy if exists "asset_value_types insert by inventory admin" on it.asset_value_types;
create policy "asset_value_types insert by inventory admin" on it.asset_value_types
  for insert to authenticated with check (has_permission('it.inventory_settings.update'));

drop policy if exists "asset_value_types update by inventory admin" on it.asset_value_types;
create policy "asset_value_types update by inventory admin" on it.asset_value_types
  for update to authenticated
  using (has_permission('it.inventory_settings.update'))
  with check (has_permission('it.inventory_settings.update'));

drop policy if exists "asset_value_types delete by inventory admin" on it.asset_value_types;
create policy "asset_value_types delete by inventory admin" on it.asset_value_types
  for delete to authenticated using (has_permission('it.inventory_settings.update'));

-- ---------------------------------------------------------------------------
-- Part 5 — seed asset types from the BRD's list (Inventory Asset Record: Laptop / Desktop /
-- Monitor / Accessory / Mobile / Other, plus the categorisation section's Printer, Server,
-- Networking Equipment). Classification is a proposal pending IT BA confirmation; change it
-- from the settings screen, not by editing this file after it's applied. Value types (New/Old)
-- are NOT seeded: their depreciation % and useful life are finance figures nobody has given us.
-- ---------------------------------------------------------------------------

insert into it.asset_types (name, classification, description) values
  ('Laptop', 'Fixed', null),
  ('Desktop', 'Fixed', null),
  ('Monitor', 'Fixed', null),
  ('Printer', 'Fixed', null),
  ('Server', 'Fixed', null),
  ('Networking Equipment', 'Fixed', 'Switches, routers, access points'),
  ('Mobile Device', 'Fixed', null),
  ('Accessory', 'Consumable', 'Mouse, keyboard, headset, cables, chargers'),
  ('Other', 'Fixed', null)
on conflict (name) do nothing;

-- Concrete grant for these pre-existing tables (default privileges from 0001 don't apply
-- retroactively to tables created before them).
grant select, insert, update, delete on it.asset_types, it.asset_value_types to authenticated;
