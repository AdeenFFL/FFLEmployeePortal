-- talha_hr_0015: rules for employees who are leaving (open clearance) or have left.
-- Depends on talha_hr_0001..0014 (hr.clearance_*), talha_it_0004 (it.asset_assignments),
-- talha_it_0008 (it.search_people), javaria_it_0002 (it.onboarding_offboarding) and
-- javaria_it_0010 (it.demands).
--
-- "Leaving" = the person has a clearance request that is Submitted or In Clearance.
-- "Left"    = the person has a Completed clearance whose last working day has passed (and they
--             have not re-joined since: date_of_joining is not after that last day).
--
--   1/2  No asset can be assigned to someone leaving or who has left (trigger on
--        it.asset_assignments: covers Inventory Assign and onboarding asset allocation).
--   4    An employee's own request: last working date at most 90 days ahead (HR keeps 365).
--   5    Someone leaving cannot be made line manager, or be handed a clearance line or asset
--        return (triggers); they also drop out of those people searches.
--   8    No new procurement demand raised by someone leaving (trigger on it.demands).
--   9    No Onboarding / Replacement request for someone leaving (Offboarding stays allowed).
--   10   People who have left are hidden from the people searches (Assign, Clearance Signers,
--        line manager / handover, IT staff, Start clearance). Their account is NOT changed here:
--        IT offboarding already sets persons.status = 'Inactive'.
--   3/6  hr.leaving_people(ids) gives the screens a "Leaving · CLR-…" tag (Assign picker,
--        Clearance Signers).
--
-- Rollback:
--   drop trigger trg_asset_assignments_leaving   on it.asset_assignments;
--   drop trigger trg_clearance_cases_leaving     on hr.clearance_cases;
--   drop trigger trg_clearance_line_assign_leaving on hr.clearance_line_assignments;
--   drop trigger trg_clearance_asset_tasks_leaving on hr.clearance_asset_tasks;
--   drop trigger trg_demands_leaving             on it.demands;
--   drop trigger trg_onboarding_leaving          on it.onboarding_offboarding;
--   then re-apply the search functions from talha_it_0008, talha_hr_0004, talha_hr_0005,
--   talha_hr_0008 and talha_hr_0011, and drop the hr.* functions created below.

begin;

-- =====================================================================
-- 1. Helpers
-- =====================================================================

-- The open clearance request of a person (case number), or null.
create or replace function hr.open_clearance_of(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.case_number
    from hr.clearance_cases c
   where c.person_id = p_person_id
     and c.status in ('Submitted', 'In Clearance')
   order by c.created_at desc
   limit 1;
$$;

-- The Completed clearance of a person who has left (last day passed, not re-joined), or null.
create or replace function hr.left_clearance_of(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.case_number
    from hr.clearance_cases c
    join public.persons p on p.id = c.person_id
   where c.person_id = p_person_id
     and c.status = 'Completed'
     and c.last_working_date < (now() at time zone 'Asia/Karachi')::date
     and (p.date_of_joining is null or p.date_of_joining <= c.last_working_date)
   order by c.last_working_date desc
   limit 1;
$$;

revoke all on function hr.open_clearance_of(uuid) from public, anon, authenticated;
revoke all on function hr.left_clearance_of(uuid) from public, anon, authenticated;
grant execute on function hr.open_clearance_of(uuid) to service_role;
grant execute on function hr.left_clearance_of(uuid) to service_role;

-- For the screens: which of these people are leaving (open request), with its case number.
create or replace function hr.leaving_people(p_person_ids uuid[])
returns table (person_id uuid, case_number text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('it.assets.assign')
          or public.has_permission('hr.clearance.read_all')
          or public.has_permission('hr.clearance.manage_signers')) then
    raise exception 'You are not allowed to see this.' using errcode = '42501';
  end if;

  return query
    select distinct on (c.person_id) c.person_id, c.case_number
      from hr.clearance_cases c
     where c.person_id = any (coalesce(p_person_ids, '{}'))
       and c.status in ('Submitted', 'In Clearance')
     order by c.person_id, c.created_at desc;
end;
$$;

revoke all on function hr.leaving_people(uuid[]) from public, anon;
grant execute on function hr.leaving_people(uuid[]) to authenticated, service_role;

-- =====================================================================
-- 2. Rules 1/2: no asset assignment to someone leaving or who has left
-- =====================================================================
create or replace function it.asset_assignments_leaving_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case text;
begin
  v_case := hr.open_clearance_of(new.person_id);
  if v_case is not null then
    raise exception 'This employee has an open clearance (%). Assets cannot be assigned.', v_case;
  end if;
  v_case := hr.left_clearance_of(new.person_id);
  if v_case is not null then
    raise exception 'This employee has left the company (clearance % completed). Assets cannot be assigned.', v_case;
  end if;
  return new;
end;
$$;

create trigger trg_asset_assignments_leaving
  before insert on it.asset_assignments
  for each row execute function it.asset_assignments_leaving_check();

-- =====================================================================
-- 3. Rule 4 (own request: at most 90 days ahead) and rule 5 (line manager not leaving)
-- =====================================================================
create or replace function hr.clearance_cases_leaving_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case text;
begin
  if tg_op = 'INSERT' then
    if new.raised_via = 'self'
       and new.last_working_date > (now() at time zone 'Asia/Karachi')::date + 90 then
      raise exception 'The last working date can be at most 90 days from today. Please speak to HR for a later date.';
    end if;
    return new;
  end if;

  if new.line_manager_person_id is not null
     and new.line_manager_person_id is distinct from old.line_manager_person_id then
    v_case := hr.open_clearance_of(new.line_manager_person_id);
    if v_case is not null then
      raise exception 'This person is leaving too (clearance %), so they cannot be the line manager.', v_case;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_clearance_cases_leaving
  before insert or update of line_manager_person_id on hr.clearance_cases
  for each row execute function hr.clearance_cases_leaving_check();

-- =====================================================================
-- 4. Rule 5: clearance lines / asset returns cannot be handed to someone leaving
-- =====================================================================
create or replace function hr.clearance_assignee_leaving_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case text;
begin
  v_case := hr.open_clearance_of(new.assignee_person_id);
  if v_case is not null then
    raise exception 'This person is leaving (clearance %), so work cannot be handed to them.', v_case;
  end if;
  return new;
end;
$$;

create trigger trg_clearance_line_assign_leaving
  before insert or update of assignee_person_id on hr.clearance_line_assignments
  for each row execute function hr.clearance_assignee_leaving_check();

create trigger trg_clearance_asset_tasks_leaving
  before insert or update of assignee_person_id on hr.clearance_asset_tasks
  for each row execute function hr.clearance_assignee_leaving_check();

-- =====================================================================
-- 5. Rule 8: no new procurement demand raised by someone leaving
-- =====================================================================
create or replace function it.demands_leaving_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case text;
begin
  v_case := hr.open_clearance_of(new.requested_by_person_id);
  if v_case is not null then
    raise exception 'You have an open clearance (%), so a new demand cannot be raised in your name.', v_case;
  end if;
  return new;
end;
$$;

create trigger trg_demands_leaving
  before insert on it.demands
  for each row execute function it.demands_leaving_check();

-- =====================================================================
-- 6. Rule 9: no Onboarding / Replacement request for someone leaving
-- =====================================================================
create or replace function it.onboarding_leaving_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case text;
begin
  if new.person_id is not null and new.kind in ('Onboarding', 'Replacement') then
    v_case := hr.open_clearance_of(new.person_id);
    if v_case is not null then
      raise exception 'This employee has an open clearance (%). Only an Offboarding request can be raised for them.', v_case;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_onboarding_leaving
  before insert on it.onboarding_offboarding
  for each row execute function it.onboarding_leaving_check();

revoke all on function it.asset_assignments_leaving_check() from public, anon, authenticated;
revoke all on function hr.clearance_cases_leaving_check()   from public, anon, authenticated;
revoke all on function hr.clearance_assignee_leaving_check() from public, anon, authenticated;
revoke all on function it.demands_leaving_check()           from public, anon, authenticated;
revoke all on function it.onboarding_leaving_check()        from public, anon, authenticated;

-- =====================================================================
-- 7. People searches (same signatures; only the filters are new)
-- =====================================================================

-- Assign picker (talha_it_0008): hide people who have left. People leaving stay visible: the
-- screen tags them "Leaving" and the trigger above refuses the assignment.
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
       and hr.left_clearance_of(p.id) is null
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Clearance Signers "add a signer" search (talha_hr_0004): no one leaving or left.
create or replace function hr.clearance_search_people(p_query text, p_limit integer default 20)
returns table (
  person_id       uuid,
  full_name       text,
  employee_code   text,
  designation     text,
  site_name       text,
  department_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.manage_signers') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  -- treat % and _ typed by the user as ordinary letters
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation, s.name, d.name
      from public.persons p
      left join public.org_units s on s.id = p.site_id
      left join public.org_units d on d.id = p.department_id
     where p.person_type = 'employee'
       and p.status = 'Active'
       and hr.open_clearance_of(p.id) is null
       and hr.left_clearance_of(p.id) is null
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Line manager / Handing over to / Email forwarding to (talha_hr_0008): no one leaving or left.
create or replace function hr.clearance_search_managers(p_query text, p_limit integer default 20)
returns table (
  person_id      uuid,
  full_name      text,
  employee_code  text,
  designation    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.sign') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation
      from public.persons p
     where p.person_type = 'employee'
       and p.status = 'Active'
       and hr.open_clearance_of(p.id) is null
       and hr.left_clearance_of(p.id) is null
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- IT staff to hand a line / asset return to (talha_hr_0011): no one leaving or left.
create or replace function hr.clearance_search_it_staff(p_query text, p_limit integer default 20)
returns table (
  person_id      uuid,
  full_name      text,
  employee_code  text,
  designation    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.sign') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation
      from public.persons p
     where hr.clearance_is_it_staff(p.id)
       and hr.open_clearance_of(p.id) is null
       and hr.left_clearance_of(p.id) is null
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Start clearance (talha_hr_0005): hide people who have already left (completed clearance).
create or replace function hr.clearance_search_employees(p_query text, p_limit integer default 20)
returns table (
  person_id        uuid,
  full_name        text,
  employee_code    text,
  designation      text,
  person_status    text,
  site_id          uuid,
  site_name        text,
  department_id    uuid,
  department_name  text,
  has_open_case    boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to start a clearance.' using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  -- treat % and _ typed by the user as ordinary letters
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation, p.status,
           p.site_id, s.name, p.department_id, d.name,
           exists (select 1 from hr.clearance_cases c
                    where c.person_id = p.id and c.status in ('Submitted', 'In Clearance'))
      from public.persons p
      left join public.org_units s on s.id = p.site_id
      left join public.org_units d on d.id = p.department_id
     where p.person_type = 'employee'
       and p.status in ('Active', 'Inactive')
       and hr.left_clearance_of(p.id) is null
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by case when p.status = 'Active' then 0 else 1 end, p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

commit;
