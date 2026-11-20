-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding clearance - prefill from the employee's onboarding request
-- Depends on:  talha_hr_0001 .. 0008 (live), it.onboarding_offboarding with reporting_manager_id
--              (migrations 0027, 0051).
-- Applied to live DB: YES (2026-11-19, by Talha)
--
-- WHY
--   When HR fills the clearance HR part, two values are usually already known from the day the
--   employee joined: the joining date and the reporting manager (= line manager). They are in
--   it.onboarding_offboarding, but the HR signer normally cannot read that table (it needs
--   it.onboarding.read). This function hands over ONLY those values, for ONE case, to the case's
--   HR signer (or hr.clearance.read_all holders).
--
--   The app uses them as suggestions only:
--     * the joining date prefills "Date of joining" when the profile has none (HR can edit it);
--     * the reporting manager is offered as "From onboarding: <name> [Choose]" in the line manager
--       picker, only while that person is still Active.
--   Nothing is written; the case keeps its own copy of the chosen manager as before.
--
-- READ ONLY: no table is changed.
--
-- Safe to undo:
--   drop function hr.clearance_onboarding_defaults(uuid);

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
