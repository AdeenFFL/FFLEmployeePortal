-- Author:      Talha
-- Branch:      it/talha
-- Feature:     IT Inventory - keep the asset assignment history when a person is deleted
-- Depends on:  talha_it_0004 (it.asset_assignments), talha_it_0011 (live: assigned_by / returned_to
--              are ON DELETE SET NULL)
-- Applied to live DB: YES (2026-11-19, by Talha)
--
-- PROBLEM
--   An assignment row stores only person ids; the names are looked up live from public.persons.
--   So the holder (person_id) had to BLOCK the delete of a person, or the history would lose who
--   held the asset. Admin > Users could therefore never delete anyone who ever held an asset.
--
-- CHANGE
--   1. A permanent copy of the names on every assignment row:
--        holder_name, holder_employee_code   (who held the asset)
--        assigned_by_name                    (who handed it over)
--        returned_to_name                    (who received it back)
--      Existing rows are filled once from persons. A trigger fills them for every new assignment
--      and every return, so it.assign_asset / it.return_asset and other callers need no change.
--      The trigger never clears a name: when a person is deleted, the id becomes null and the
--      copied name stays.
--   2. person_id -> nullable, ON DELETE SET NULL (the row and the names stay).
--   3. Safety rule: person_id may only be empty on a RETURNED row. Deleting someone who still
--      HOLDS an asset fails with check_violation (23514) on
--      asset_assignments_holder_needed_while_open, so an asset is never left "In Use" with no
--      holder. The app shows: "This employee still holds IT assets. Return them first, or set
--      them Inactive."
--
-- Safe to undo (only while no row has a NULL person_id):
--   drop trigger trg_asset_assignments_copy_names on it.asset_assignments;
--   drop function it.asset_assignments_copy_names();
--   alter table it.asset_assignments drop constraint asset_assignments_holder_needed_while_open;
--   alter table it.asset_assignments drop constraint asset_assignments_person_id_fkey;
--   alter table it.asset_assignments add constraint asset_assignments_person_id_fkey
--     foreign key (person_id) references public.persons (id);
--   alter table it.asset_assignments alter column person_id set not null;
--   alter table it.asset_assignments drop column holder_name, drop column holder_employee_code,
--     drop column assigned_by_name, drop column returned_to_name;

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
