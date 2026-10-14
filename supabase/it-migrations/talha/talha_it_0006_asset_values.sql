-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Phase 6 - Asset valuation and depreciation - see 07-it-inventory-plan.md
-- Depends on:  talha_it_0003_assets.sql, existing it.asset_value_types
-- Applied to live DB: YES (2026-10-14, by Talha)

-- Safe to undo while the table is still empty:
--   drop table it.asset_values;

begin;

-- One row = one valuation of one asset on one date (history is kept).
create table it.asset_values (
  id                        uuid primary key default gen_random_uuid(),
  asset_id                  uuid not null references it.assets (id),
  value_type_id             uuid not null references it.asset_value_types (id),  -- New / Old
  purchase_value            numeric(12,2) not null check (purchase_value >= 0),
  current_value             numeric(12,2) not null check (current_value >= 0),
  accumulated_depreciation  numeric(12,2) not null default 0 check (accumulated_depreciation >= 0),
  salvage_value             numeric(12,2) not null default 0 check (salvage_value >= 0),
  valuation_date            date not null default current_date,
  remarks                   text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid default public.current_person_id() references public.persons (id),
  updated_by                uuid references public.persons (id)
);

create index idx_asset_values_asset on it.asset_values (asset_id);
create index idx_asset_values_type  on it.asset_values (value_type_id);

create trigger trg_asset_values_updated_at
  before update on it.asset_values
  for each row execute function public.set_updated_at();

-- ---------- security ----------
-- No delete for logged-in users (valuation history is kept).
grant select, insert, update on it.asset_values to authenticated;
grant select, insert, update, delete on it.asset_values to service_role;

alter table it.asset_values enable row level security;

-- ASSUMPTION: anyone who can read assets can read values. If money figures
-- should be more private, change this to it.valuation.update. Ask your boss.
create policy "values readable by asset viewers"
  on it.asset_values for select to authenticated
  using (public.has_permission('it.assets.read'));

create policy "values insert by valuation editors"
  on it.asset_values for insert to authenticated
  with check (public.has_permission('it.valuation.update'));

create policy "values update by valuation editors"
  on it.asset_values for update to authenticated
  using (public.has_permission('it.valuation.update'))
  with check (public.has_permission('it.valuation.update'));

commit;
