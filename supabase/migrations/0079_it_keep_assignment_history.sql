-- Replicated from supabase/it-migrations/talha/talha_it_0012_keep_assignment_history.sql (applied
-- live 2026-11-19, by Talha). Depends on 0078 (this batch) for assigned_by/returned_to ON DELETE
-- SET NULL.
--
-- Keeps the asset assignment history readable when a person is deleted: adds holder_name,
-- holder_employee_code, assigned_by_name and returned_to_name columns on it.asset_assignments,
-- copied from the person record at the time, so the name survives after person_id goes null.

begin;

-- 1. The name copies ----------------------------------------------------------------------------
alter table it.asset_assignments
  add column holder_name           text,
  add column holder_employee_code  text,
  add column assigned_by_name      text,
  add column returned_to_name      text;

-- Fill the existing rows once. The updated_at trigger is paused so the history keeps its real
-- "last changed" times.
alter table it.asset_assignments disable trigger trg_asset_assignments_updated_at;

update it.asset_assignments a
   set holder_name          = p.full_name,
       holder_employee_code = p.employee_code
  from public.persons p
 where p.id = a.person_id;

update it.asset_assignments a
   set assigned_by_name = p.full_name
  from public.persons p
 where p.id = a.assigned_by_person_id;

update it.asset_assignments a
   set returned_to_name = p.full_name
  from public.persons p
 where p.id = a.returned_to_person_id;

alter table it.asset_assignments enable trigger trg_asset_assignments_updated_at;

-- Copies the names whenever an id is SET (insert, or changed to another person). When an id
-- becomes null (the person was deleted) the copied name is kept.
create or replace function it.asset_assignments_copy_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is not null
     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id) then
    select p.full_name, p.employee_code
      into new.holder_name, new.holder_employee_code
      from public.persons p
     where p.id = new.person_id;
  end if;

  if new.assigned_by_person_id is not null
     and (tg_op = 'INSERT' or new.assigned_by_person_id is distinct from old.assigned_by_person_id) then
    select p.full_name into new.assigned_by_name
      from public.persons p
     where p.id = new.assigned_by_person_id;
  end if;

  if new.returned_to_person_id is not null
     and (tg_op = 'INSERT' or new.returned_to_person_id is distinct from old.returned_to_person_id) then
    select p.full_name into new.returned_to_name
      from public.persons p
     where p.id = new.returned_to_person_id;
  end if;

  return new;
end;
$$;

revoke all on function it.asset_assignments_copy_names() from public, anon, authenticated;

create trigger trg_asset_assignments_copy_names
  before insert or update of person_id, assigned_by_person_id, returned_to_person_id
  on it.asset_assignments
  for each row execute function it.asset_assignments_copy_names();

-- 2. Deleting the holder keeps the row ----------------------------------------------------------
alter table it.asset_assignments alter column person_id drop not null;
alter table it.asset_assignments drop constraint if exists asset_assignments_person_id_fkey;
alter table it.asset_assignments add constraint asset_assignments_person_id_fkey
  foreign key (person_id) references public.persons (id) on delete set null;

-- 3. ...but never while they still hold the asset -----------------------------------------------
alter table it.asset_assignments add constraint asset_assignments_holder_needed_while_open
  check (person_id is not null or return_date is not null);

commit;

-- CHECKS (run after applying):
--   a) every row has a holder name (should return 0):
--        select count(*) from it.asset_assignments where holder_name is null;
--   b) delete rule (should be SET NULL):
--        select rc.delete_rule from information_schema.referential_constraints rc
--         where rc.constraint_schema = 'it'
--           and rc.constraint_name = 'asset_assignments_person_id_fkey';
