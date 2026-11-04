-- Employee Portal — split the remaining two lifecycle kinds off the old one-permission-covers-
-- all-three-kinds it.onboarding.create, same as 0055 already did for Offboarding:
--   * hr.onboarding.create   — raise a new-hire onboarding request.
--   * hr.replacement.create  — raise an asset/role replacement request for an existing employee.
-- it.onboarding.create itself is left in place (still used by it.onboarding.assign/update's
-- sibling checks and it.search_employees' existing OR clause) — nothing asked for its removal,
-- only for raising each kind to have its own dedicated permission.

begin;

insert into permissions (key, module, label, description) values
  ('hr.onboarding.create', 'hr', 'Raise Onboarding Request',
   'Raise a new-hire onboarding request'),
  ('hr.replacement.create', 'hr', 'Raise Replacement Request',
   'Raise an asset/role replacement request for an existing employee')
on conflict (key) do nothing;

-- Rollout safety: everyone who could already raise any lifecycle request keeps being able to
-- raise onboarding and replacement ones specifically.
insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id and p_old.key = 'it.onboarding.create'
cross join permissions p_new
where p_new.key in ('hr.onboarding.create', 'hr.replacement.create')
on conflict do nothing;

-- Narrow the old blanket HR insert policy: Offboarding is no longer covered here at all — fully
-- owned by the two hr.offboarding.* policies from 0055_hr_offboarding_permissions.sql — and
-- Onboarding/Replacement each now check their own dedicated permission.
drop policy "onboarding_offboarding insert by hr" on it.onboarding_offboarding;
create policy "onboarding_offboarding insert by hr" on it.onboarding_offboarding
  for insert to authenticated with check (
    (kind = 'Onboarding' and has_permission('hr.onboarding.create'))
    or (kind = 'Replacement' and has_permission('hr.replacement.create'))
  );

-- it.search_employees()'s picker is shared by the Replacement tab (still unrestricted, unchanged
-- behavior) and the "add site IT staff" picker; add the new permission to its gate so a role
-- holding only hr.replacement.create (without the legacy it.onboarding.create) can still search
-- for the employee to replace. Return shape is unchanged, so create or replace is safe here.
create or replace function it.search_employees(p_search text)
returns table (
  person_id uuid,
  full_name text,
  employee_code text,
  designation text,
  site_id uuid,
  status text,
  onboarding_cleared boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id, p.full_name, p.employee_code, p.designation, p.site_id, p.status,
    (
      not exists (select 1 from it.onboarding_offboarding o where o.person_id = p.id and o.kind = 'Onboarding')
      or exists (
        select 1 from it.onboarding_offboarding o
        where o.person_id = p.id and o.kind = 'Onboarding' and o.status in ('Completed', 'Closed')
      )
    ) as onboarding_cleared
  from persons p
  where (has_permission('it.onboarding.create')
         or has_permission('it.onboarding.assign')
         or has_permission('it.onboarding.update')
         or has_permission('hr.replacement.create'))
    and p.person_type = 'employee'
    and (
      coalesce(trim(p_search), '') = ''
      or p.full_name ilike '%' || trim(p_search) || '%'
      or p.employee_code ilike '%' || trim(p_search) || '%'
    )
  order by p.full_name
  limit 50;
$$;

commit;
