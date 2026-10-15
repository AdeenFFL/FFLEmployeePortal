-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Phase 3 - people lookup for the Assign form and Assignment history
-- Depends on:  public.persons (columns id, full_name, designation, employee_code,
--              person_type, status), public.has_permission(), public.current_person_id().
-- Applied to live DB: YES (2026-10-15, by Talha)
--
-- WHY: it.person_names() (Javaria's) only shows names to people with
-- it.tickets.read / it.onboarding.read, and it cannot SEARCH. Inventory staff
-- need both. These two functions are new and independent; Javaria's function
-- is not touched.
--
-- NOTE: search_people lists only ACTIVE EMPLOYEES (person_type = 'employee' and
-- status = 'Active'), so ex-employees and third parties cannot be picked.
-- asset_person_names has NO such filter on purpose: the history must still
-- show the names of people who have since left.

-- Safe to undo:
--   drop function it.search_people(text, integer);
--   drop function it.asset_person_names(uuid[]);

begin;

-- ---------------------------------------------------------------------
-- search_people: type 2+ letters of a name or employee code, get matches
-- (active employees only).
-- Only people who may assign assets can use it (max 50 results).
-- ---------------------------------------------------------------------
create or replace function it.search_people(p_query text, p_limit integer default 20)
returns table (person_id uuid, full_name text, designation text, employee_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('it.assets.assign') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;   -- too short: return nothing instead of listing everyone
  end if;

  -- treat % and _ typed by the user as ordinary letters
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.designation, p.employee_code
      from public.persons p
     where p.person_type = 'employee'
       and p.status = 'Active'
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------
-- asset_person_names: names for a list of ids (assignment history:
-- "who held it", "who handed it over", "who received it back").
-- Allowed for people who can read assets, and for yourself.
-- ---------------------------------------------------------------------
create or replace function it.asset_person_names(p_person_ids uuid[])
returns table (person_id uuid, full_name text, designation text, employee_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.designation, p.employee_code
    from public.persons p
   where p.id = any (p_person_ids)
     and (public.has_permission('it.assets.read')
          or p.id = public.current_person_id());
$$;

revoke all on function it.search_people(text, integer)   from public, anon;
revoke all on function it.asset_person_names(uuid[])     from public, anon;

grant execute on function it.search_people(text, integer) to authenticated, service_role;
grant execute on function it.asset_person_names(uuid[])   to authenticated, service_role;

commit;
