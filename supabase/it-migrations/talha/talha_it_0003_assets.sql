-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Phase 2 - Asset register (it.assets) - see 07-it-inventory-plan.md
-- Depends on:  existing it.asset_types (already live).
--              Needs public.persons, public.companies, public.org_units,
--              public.set_updated_at(), public.has_permission(), it.next_number().
--              Permission rows (it.assets.*) are added in a SEPARATE file; this
--              file works without them (nobody gets access until they exist).
-- Applied to live DB: NO

-- Safe to undo while the table is still empty:
--   drop table it.assets;

begin;

create table it.assets (
  id                uuid primary key default gen_random_uuid(),

  -- Auto-generated tag, e.g. AST-000001.
  -- PLACEHOLDER: the plan wants <COMPANY>-<TYPE>-<seq> (e.g. FFL-LAP-000123),
  -- still "pending BA confirmation". Changing it later = one line.
  asset_tag         text not null unique default it.next_number('AST'),

  serial_number     text not null,
  asset_name        text not null,
  asset_type_id     uuid not null references it.asset_types (id),
  manufacturer      text,
  model_number      text,

  company_id        uuid not null references public.companies (id),   -- replaces ERD "owning_company"
  site_id           uuid references public.org_units (id),            -- replaces ERD "current_location_id"
  purchase_date     date,

  -- Columns exist now, but the links to Javeria's vendors / receiving tables
  -- are added later (Phase 7), once her tables exist.
  vendor_id         uuid,
  receiving_id      uuid,

  status            text not null default 'Unassigned'
                    check (status in ('Unassigned', 'In Use', 'In Repair',
                                      'Retired', 'Disposed', 'Lost')),
  condition         text,
  warranty_expiry   date,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default public.current_person_id() references public.persons (id),
  updated_by        uuid references public.persons (id),
  deleted_at        timestamptz      -- "soft delete": row is hidden, never erased
);

-- A serial number must be unique among assets that are not deleted
-- (so a mistaken entry that was deleted doesn't block re-registering it).
create unique index uq_assets_serial_live
  on it.assets (serial_number)
  where deleted_at is null;

create index idx_assets_type    on it.assets (asset_type_id);
create index idx_assets_company on it.assets (company_id);
create index idx_assets_site    on it.assets (site_id);
create index idx_assets_status  on it.assets (status);

create trigger trg_assets_updated_at
  before update on it.assets
  for each row execute function public.set_updated_at();

-- ---------- permissions on the table itself ----------
-- No DELETE for logged-in users: assets are soft-deleted instead.
grant select, insert, update on it.assets to authenticated;
grant select, insert, update, delete on it.assets to service_role;

-- ---------- security (Row Level Security) ----------
alter table it.assets enable row level security;

create policy "assets readable by asset viewers"
  on it.assets for select to authenticated
  using (public.has_permission('it.assets.read'));

create policy "assets insert by asset creators"
  on it.assets for insert to authenticated
  with check (public.has_permission('it.assets.create'));

create policy "assets update by asset editors"
  on it.assets for update to authenticated
  using (public.has_permission('it.assets.update'))
  with check (public.has_permission('it.assets.update'));

-- Soft delete is an UPDATE that sets deleted_at, so it gets its own permission.
-- (The app's Server Action must also check it.assets.delete - defense in depth.)
create policy "assets soft delete by asset deleters"
  on it.assets for update to authenticated
  using (public.has_permission('it.assets.delete'))
  with check (public.has_permission('it.assets.delete'));

-- NOTE for Phase 3: employees need to see the assets assigned to THEM
-- (My Assets screen). That extra read policy is added together with
-- it.asset_assignments.

commit;
