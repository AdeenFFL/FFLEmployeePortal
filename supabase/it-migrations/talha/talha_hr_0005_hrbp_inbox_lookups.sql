-- Author:      Talha
-- Branch:      it/talha
-- Feature:     HRBP inbox (/hr/resignations) - two lookups
-- Depends on:  talha_hr_0001 .. 0004 (live). Uses public.persons (id, full_name, employee_code,
--              designation, status, person_type, site_id, department_id), public.org_units (id, name),
--              hr.clearance_cases, hr.has_permission via public.has_permission().
-- Applied to live DB: YES (2026-11-16, by Talha)
--
-- WHY
--   1. An HRBP (hr.clearance.read_all + hr.clearance.forward, no admin rights) cannot read
--      public.persons, and hr.clearance_search_people needs manage_signers (HR/Admin only).
--      So starting a clearance for an employee needs its own search.
--   2. A case keeps a SNAPSHOT of the employee's site and department taken when it was
--      submitted. forward_clearance_case checks that snapshot. If the employee had no site
--      then and Admin sets it later, forwarding failed forever. refresh_clearance_case_org
--      copies the CURRENT site and department from the profile onto a Submitted case.
--
--   hr.clearance_search_employees(q, limit)   needs hr.clearance.forward
--   hr.refresh_clearance_case_org(case_id)    needs hr.clearance.forward, Submitted cases only

-- Safe to undo:
--   drop function hr.refresh_clearance_case_org(uuid);
--   drop function hr.clearance_search_employees(text, integer);

begin;

-- ---------------------------------------------------------------------
-- 1. Search employees to start a clearance for (Active, or Inactive = recent leaver)
-- ---------------------------------------------------------------------
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
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by case when p.status = 'Active' then 0 else 1 end, p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Refresh a Submitted case's site and department from the employee's profile
-- ---------------------------------------------------------------------
create or replace function hr.refresh_clearance_case_org(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_p    record;
begin
  if not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to update clearance requests.' using errcode = '42501';
  end if;

  select c.id, c.status, c.person_id
    into v_case
    from hr.clearance_cases c
   where c.id = p_case_id
   for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.status <> 'Submitted' then
    raise exception 'Only a Submitted request can be updated from the profile (this one is %).', v_case.status;
  end if;

  select p.site_id, p.department_id, p.designation, p.company_id
    into v_p
    from public.persons p
   where p.id = v_case.person_id;
  if not found then
    raise exception 'Employee not found.';
  end if;

  if v_p.site_id is null and v_p.department_id is null then
    raise exception 'The employee profile still has no site and no department. Ask Admin to set them in Admin > Users first.';
  end if;

  update hr.clearance_cases
     set site_id       = v_p.site_id,
         department_id = v_p.department_id,
         designation   = coalesce(v_p.designation, designation),
         company_id    = coalesce(v_p.company_id, company_id)
   where id = p_case_id;
end;
$$;

revoke all on function hr.clearance_search_employees(text, integer) from public, anon;
revoke all on function hr.refresh_clearance_case_org(uuid)          from public, anon;

grant execute on function hr.clearance_search_employees(text, integer) to authenticated, service_role;
grant execute on function hr.refresh_clearance_case_org(uuid)          to authenticated, service_role;

commit;
