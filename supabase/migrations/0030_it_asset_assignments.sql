-- Employee Portal — IT module (M2), Inventory track: asset assignments (it.asset_assignments)
-- and the assign/return/acknowledge RPCs + My Assets support. Replicated into the main
-- sequence from supabase/it-migrations/talha/talha_it_0004_asset_assignments.sql (Talha,
-- it/talha) — confirmed already live via direct inspection, not re-run here.
-- 
-- Also the file that actually owns the FKs tickets.linked_asset_id -> it.assets and
-- checklist_items.assignment_id -> it.asset_assignments (see its own "Safe to undo" notes
-- below) — both already verified live when the ticket/onboarding IT module revision work
-- (0041/0042) was done.

-- Safe to undo while the table is still empty:
--   drop policy "assets readable by current holder" on it.assets;
--   drop function it.assign_asset(uuid, uuid, text, text, date);
--   drop function it.return_asset(uuid, text, text, date, text);
--   drop function it.acknowledge_assignment(uuid);
--   alter table it.checklist_items drop constraint checklist_items_assignment_id_fkey;
--   alter table it.tickets drop constraint tickets_linked_asset_id_fkey;
--   drop table it.asset_assignments;

begin;

-- ---------------------------------------------------------------------
-- 1. The assignment history table.
--    One row = one period when one person held one asset.
--    Rows are never overwritten: a return just fills in the return columns.
-- ---------------------------------------------------------------------
create table it.asset_assignments (
  id                      uuid primary key default gen_random_uuid(),
  asset_id                uuid not null references it.assets (id),
  person_id               uuid not null references public.persons (id),   -- who holds the asset (ERD "employee_id")
  company_id              uuid not null references public.companies (id), -- copied from the asset
  site_id                 uuid references public.org_units (id),          -- copied from the asset
  assigned_by_person_id   uuid not null references public.persons (id),
  returned_to_person_id   uuid references public.persons (id),
  assigned_date           date not null default current_date,
  return_date             date,
  assigned_condition      text,
  returned_condition      text,
  -- ASSUMPTION: the ERD does not list the values. Confirm with your boss.
  status                  text not null default 'Active'
                          check (status in ('Active', 'Returned')),
  remarks                 text,
  -- ADDITION (not in the ERD): the plan's "My Assets" screen has an
  -- "acknowledge handover" button, which needs somewhere to store the time.
  acknowledged_at         timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default public.current_person_id() references public.persons (id),
  updated_by              uuid references public.persons (id),

  check (return_date is null or return_date >= assigned_date),
  check ((status = 'Active') = (return_date is null))
);

-- Plan item #7: an asset can have at most ONE current holder.
create unique index uq_one_open_assignment_per_asset
  on it.asset_assignments (asset_id)
  where return_date is null;

create index idx_assignments_asset  on it.asset_assignments (asset_id);
create index idx_assignments_person on it.asset_assignments (person_id);

create trigger trg_asset_assignments_updated_at
  before update on it.asset_assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Security: people can only READ this table directly.
--    All changes go through the three functions below, so the assignment
--    and the asset's status can never drift apart.
-- ---------------------------------------------------------------------
grant select on it.asset_assignments to authenticated;
grant select, insert, update, delete on it.asset_assignments to service_role;

alter table it.asset_assignments enable row level security;

create policy "assignments readable by asset viewers or the holder"
  on it.asset_assignments for select to authenticated
  using (public.has_permission('it.assets.read')
         or person_id = public.current_person_id());

-- The "My Assets" screen: a person may read the asset rows they currently hold.
create policy "assets readable by current holder"
  on it.assets for select to authenticated
  using (exists (
    select 1
    from it.asset_assignments a
    where a.asset_id = assets.id
      and a.return_date is null
      and a.person_id = public.current_person_id()
  ));

-- ---------------------------------------------------------------------
-- 3. assign_asset: give an available asset to a person.
-- ---------------------------------------------------------------------
create or replace function it.assign_asset(
  p_asset_id      uuid,
  p_person_id     uuid,
  p_condition     text default null,
  p_remarks       text default null,
  p_assigned_date date default current_date
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
  if v_me is null or not public.has_permission('it.assets.assign') then
    raise exception 'You are not allowed to assign assets.' using errcode = '42501';
  end if;

  -- Lock the asset row so two people cannot assign it at the same moment.
  select a.id, a.status, a.company_id, a.site_id, a.condition, a.deleted_at
    into v_asset
    from it.assets a
   where a.id = p_asset_id
   for update;

  if not found or v_asset.deleted_at is not null then
    raise exception 'Asset not found.';
  end if;

  if v_asset.status <> 'Unassigned' then
    raise exception 'This asset cannot be assigned because its status is "%".', v_asset.status;
  end if;

  insert into it.asset_assignments
    (asset_id, person_id, company_id, site_id, assigned_by_person_id,
     assigned_date, assigned_condition, remarks, created_by, updated_by)
  values
    (p_asset_id, p_person_id, v_asset.company_id, v_asset.site_id, v_me,
     p_assigned_date, coalesce(p_condition, v_asset.condition), p_remarks, v_me, v_me)
  returning id into v_id;

  update it.assets
     set status = 'In Use', updated_by = v_me
   where id = p_asset_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. return_asset: record that the person gave the asset back.
--    p_new_status = what happens to the asset next (default: back to stock).
-- ---------------------------------------------------------------------
create or replace function it.return_asset(
  p_assignment_id      uuid,
  p_returned_condition text default null,
  p_remarks            text default null,
  p_return_date        date default current_date,
  p_new_status         text default 'Unassigned'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := public.current_person_id();
  v_asg record;
begin
  if v_me is null or not public.has_permission('it.assets.assign') then
    raise exception 'You are not allowed to return assets.' using errcode = '42501';
  end if;

  if p_new_status not in ('Unassigned', 'In Repair', 'Retired') then
    raise exception 'After a return the asset status must be Unassigned, In Repair or Retired.';
  end if;

  select s.id, s.asset_id, s.return_date
    into v_asg
    from it.asset_assignments s
   where s.id = p_assignment_id
   for update;

  if not found then
    raise exception 'Assignment not found.';
  end if;

  if v_asg.return_date is not null then
    raise exception 'This asset has already been returned.';
  end if;

  update it.asset_assignments
     set return_date           = p_return_date,
         returned_condition    = p_returned_condition,
         returned_to_person_id = v_me,
         status                = 'Returned',
         remarks               = coalesce(p_remarks, remarks),
         updated_by            = v_me
   where id = p_assignment_id;

  update it.assets
     set status     = p_new_status,
         condition  = coalesce(p_returned_condition, condition),
         updated_by = v_me
   where id = v_asg.asset_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. acknowledge_assignment: the holder confirms "yes, I received it".
--    Only the person who holds the asset can do this, only once.
-- ---------------------------------------------------------------------
create or replace function it.acknowledge_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  update it.asset_assignments
     set acknowledged_at = now(), updated_by = v_me
   where id = p_assignment_id
     and person_id = v_me
     and return_date is null
     and acknowledged_at is null;

  if not found then
    raise exception 'Nothing to acknowledge for this assignment.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Who may call the functions: logged-in users only (never anonymous).
--    The functions themselves also check the permission.
-- ---------------------------------------------------------------------
revoke all on function it.assign_asset(uuid, uuid, text, text, date) from public, anon;
revoke all on function it.return_asset(uuid, text, text, date, text) from public, anon;
revoke all on function it.acknowledge_assignment(uuid)               from public, anon;

grant execute on function it.assign_asset(uuid, uuid, text, text, date) to authenticated, service_role;
grant execute on function it.return_asset(uuid, text, text, date, text) to authenticated, service_role;
grant execute on function it.acknowledge_assignment(uuid)               to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Links on Javaria's tables (they were plain uuid columns until now).
--    Adds links only; no data or columns of hers are changed.
--    If a row in those tables holds an id that does not exist, this fails
--    and the whole file is rolled back (nothing half-applied).
-- ---------------------------------------------------------------------
alter table it.tickets
  add constraint tickets_linked_asset_id_fkey
  foreign key (linked_asset_id) references it.assets (id);

alter table it.checklist_items
  add constraint checklist_items_assignment_id_fkey
  foreign key (assignment_id) references it.asset_assignments (id);

commit;
