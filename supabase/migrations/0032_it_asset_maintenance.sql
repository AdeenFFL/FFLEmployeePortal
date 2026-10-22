-- Employee Portal — IT module (M2), Inventory track: repair / maintenance log
-- (it.asset_maintenance) and the open/close maintenance RPCs. Replicated into the main
-- sequence from supabase/it-migrations/talha/talha_it_0005_asset_maintenance.sql (Talha,
-- it/talha) — confirmed already live via direct inspection, not re-run here.

-- Safe to undo while the table is still empty:
--   drop function it.open_maintenance(uuid, text, text, date);
--   drop function it.close_maintenance(uuid, text, numeric, date, text);
--   drop table it.asset_maintenance;

begin;

create table it.asset_maintenance (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references it.assets (id),
  company_id      uuid not null references public.companies (id),  -- copied from the asset
  site_id         uuid references public.org_units (id),           -- copied from the asset
  vendor_id       uuid,   -- link to Javeria's vendors table is added later (Phase 7)
  issue_type      text not null,
  description     text,
  service_date    date not null default current_date,
  cost            numeric(12,2) not null default 0 check (cost >= 0),
  -- ASSUMPTION: the ERD does not list the values. Confirm with your boss.
  status          text not null default 'Open' check (status in ('Open', 'Completed')),
  resolution      text,
  returned_date   date,
  remarks         text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default public.current_person_id() references public.persons (id),
  updated_by      uuid references public.persons (id),

  check (returned_date is null or returned_date >= service_date),
  check ((status = 'Completed') = (returned_date is not null))
);

-- An asset can only have one repair open at a time.
create unique index uq_one_open_maintenance_per_asset
  on it.asset_maintenance (asset_id)
  where status = 'Open';

create index idx_maintenance_asset on it.asset_maintenance (asset_id);

create trigger trg_asset_maintenance_updated_at
  before update on it.asset_maintenance
  for each row execute function public.set_updated_at();

-- ---------- security: read only; changes go through the two functions ----------
grant select on it.asset_maintenance to authenticated;
grant select, insert, update, delete on it.asset_maintenance to service_role;

alter table it.asset_maintenance enable row level security;

create policy "maintenance readable by asset viewers"
  on it.asset_maintenance for select to authenticated
  using (public.has_permission('it.assets.read')
         or public.has_permission('it.maintenance.update'));

-- ---------------------------------------------------------------------
-- open_maintenance: send an asset for repair. Sets the asset to "In Repair".
-- ---------------------------------------------------------------------
create or replace function it.open_maintenance(
  p_asset_id     uuid,
  p_issue_type   text,
  p_description  text default null,
  p_service_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_person_id();
  v_asset record;
  v_id    uuid;
begin
  if v_me is null or not public.has_permission('it.maintenance.update') then
    raise exception 'You are not allowed to manage maintenance.' using errcode = '42501';
  end if;

  if p_issue_type is null or btrim(p_issue_type) = '' then
    raise exception 'Please enter the issue type.';
  end if;

  select a.id, a.status, a.company_id, a.site_id, a.deleted_at
    into v_asset
    from it.assets a
   where a.id = p_asset_id
   for update;

  if not found or v_asset.deleted_at is not null then
    raise exception 'Asset not found.';
  end if;

  if v_asset.status in ('Retired', 'Disposed', 'Lost') then
    raise exception 'An asset with status "%" cannot be sent for repair.', v_asset.status;
  end if;

  if v_asset.status = 'In Repair' then
    raise exception 'This asset is already in repair.';
  end if;

  insert into it.asset_maintenance
    (asset_id, company_id, site_id, issue_type, description, service_date, created_by, updated_by)
  values
    (p_asset_id, v_asset.company_id, v_asset.site_id, p_issue_type, p_description,
     p_service_date, v_me, v_me)
  returning id into v_id;

  update it.assets
     set status = 'In Repair', updated_by = v_me
   where id = p_asset_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- close_maintenance: repair finished. The asset goes back to "In Use" if
-- someone still holds it, otherwise to "Unassigned".
-- ---------------------------------------------------------------------
create or replace function it.close_maintenance(
  p_maintenance_id uuid,
  p_resolution     text,
  p_cost           numeric default null,
  p_returned_date  date default current_date,
  p_remarks        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := public.current_person_id();
  v_m       record;
  v_restore text;
begin
  if v_me is null or not public.has_permission('it.maintenance.update') then
    raise exception 'You are not allowed to manage maintenance.' using errcode = '42501';
  end if;

  select m.id, m.asset_id, m.status
    into v_m
    from it.asset_maintenance m
   where m.id = p_maintenance_id
   for update;

  if not found then
    raise exception 'Maintenance record not found.';
  end if;

  if v_m.status <> 'Open' then
    raise exception 'This maintenance record is already closed.';
  end if;

  update it.asset_maintenance
     set status        = 'Completed',
         resolution    = p_resolution,
         cost          = coalesce(p_cost, cost),
         returned_date = p_returned_date,
         remarks       = coalesce(p_remarks, remarks),
         updated_by    = v_me
   where id = p_maintenance_id;

  select case when exists (
           select 1 from it.asset_assignments s
            where s.asset_id = v_m.asset_id and s.return_date is null)
         then 'In Use' else 'Unassigned' end
    into v_restore;

  update it.assets
     set status = v_restore, updated_by = v_me
   where id = v_m.asset_id
     and status = 'In Repair';
end;
$$;

revoke all on function it.open_maintenance(uuid, text, text, date)            from public, anon;
revoke all on function it.close_maintenance(uuid, text, numeric, date, text)  from public, anon;

grant execute on function it.open_maintenance(uuid, text, text, date)           to authenticated, service_role;
grant execute on function it.close_maintenance(uuid, text, numeric, date, text) to authenticated, service_role;

commit;
