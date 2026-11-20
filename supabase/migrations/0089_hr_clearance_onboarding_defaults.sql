-- Replicated from supabase/it-migrations/talha/talha_hr_0010_clearance_onboarding_defaults.sql
-- (applied live 2026-11-19, by Talha). Depends on 0080-0088 (this batch) and
-- it.onboarding_offboarding's reporting_manager_id (already in the main sequence as 0027/0051).
--
-- Prefills clearance from the employee's own onboarding request where one exists.

begin;

create or replace function hr.clearance_onboarding_defaults(p_case_id uuid)
returns table (
  joining_date            date,
  manager_person_id       uuid,
  manager_name            text,
  manager_employee_code   text,
  manager_designation     text,
  manager_is_active       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  select c.person_id into v_person from hr.clearance_cases c where c.id = p_case_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if not (public.has_permission('hr.clearance.read_all')
          or hr.is_clearance_signer(p_case_id, 'hr')) then
    raise exception 'You are not allowed to see these details.' using errcode = '42501';
  end if;

  -- The employee's latest onboarding request that was not cancelled. The manager's current name
  -- and status come from persons (the name on the request may be old); if that person was
  -- deleted, reporting_manager_id is null and only the stored name is returned.
  return query
    select o.joining_date,
           m.id,
           coalesce(m.full_name, o.reporting_manager_name),
           m.employee_code,
           m.designation,
           coalesce(m.status = 'Active' and m.person_type = 'employee', false)
      from it.onboarding_offboarding o
      left join public.persons m on m.id = o.reporting_manager_id
     where o.kind = 'Onboarding'
       and o.person_id = v_person
       and o.status <> 'Cancelled'
     order by o.created_at desc
     limit 1;
end;
$$;

revoke all on function hr.clearance_onboarding_defaults(uuid) from public, anon;
grant execute on function hr.clearance_onboarding_defaults(uuid) to authenticated, service_role;

commit;

-- Check (run after applying, as an HR signer of an open case):
--   select * from hr.clearance_onboarding_defaults('<case id>');
