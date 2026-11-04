-- Employee Portal — split self-service IT offboarding into two explicit, HR-module-managed
-- permissions instead of the single blanket module:it gate it rode in on:
--   * hr.offboarding.create_self            — file your own offboarding request.
--   * hr.offboarding.create_for_site_users  — file one on behalf of any employee at a site
--     you're on the IT team for (it.site_it_staff), mirroring the it.*_all / site-scoped
--     convention from 0037_it_site_routing.sql but without a "_all"/HQ-wide tier — nobody
--     asked for one, and it.onboarding.create already covers the unrestricted HR/IT-staff path.
--
-- Keyed hr.* / module 'hr' (not it.*) on purpose, even though the table they gate is
-- it.onboarding_offboarding: this is how an HR-module-owned permission is expressed today —
-- app/(protected)/admin/roles/page.tsx's MODULE_OWNED_PREFIXES hides any "hr."-keyed permission
-- from the cross-module screen so it only shows up on HR's own /hr/admin/roles screen, which is
-- exactly where the user wants these two toggles to live.

begin;

insert into permissions (key, module, label, description) values
  ('hr.offboarding.create_self', 'hr', 'Submit Offboarding Request (Self)',
   'File your own IT offboarding / resignation request'),
  ('hr.offboarding.create_for_site_users', 'hr', 'Submit Offboarding Request (Site Employees)',
   'File an offboarding request on behalf of any employee at a site you are on the IT team for')
on conflict (key) do nothing;

-- Rollout safety: createSelfOffboardingRequest was gated on module:it alone until now, so give
-- every role that holds module:it the new explicit permission too, or existing self-filers would
-- silently lose the ability the moment this ships.
insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id and p_old.key = 'module:it'
cross join permissions p_new
where p_new.key = 'hr.offboarding.create_self'
on conflict do nothing;

-- Roles that could already raise an Offboarding request on someone else's behalf via the
-- HR/IT-staff screen (/it/onboarding/new?kind=Offboarding, gated it.onboarding.create) get the
-- new site-scoped permission too, so nobody loses a capability they already had — they're just
-- now also offered the lighter-weight, site-scoped entry point from the ticket screens.
insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id and p_old.key = 'it.onboarding.create'
cross join permissions p_new
where p_new.key = 'hr.offboarding.create_for_site_users'
on conflict do nothing;

-- ===========================================================================
-- RLS — swap the module:it-implied self-insert for the explicit permission, and add a second
-- insert path for staff filing on behalf of any employee at a site they're staffed on.
-- ===========================================================================

drop policy "onboarding_offboarding insert self offboarding" on it.onboarding_offboarding;
create policy "onboarding_offboarding insert self offboarding" on it.onboarding_offboarding
  for insert to authenticated with check (
    kind = 'Offboarding'
    and person_id = current_person_id()
    and has_permission('hr.offboarding.create_self')
  );

-- site_id is resolved by the existing it.lifecycle_before_insert() BEFORE-trigger (coalesced from
-- the target person's own persons.site_id) before this WITH CHECK runs, same ordering the
-- existing SELECT policy already relies on (0052_it_onboarding_site_scoping.sql).
create policy "onboarding_offboarding insert for site employees" on it.onboarding_offboarding
  for insert to authenticated with check (
    kind = 'Offboarding'
    and has_permission('hr.offboarding.create_for_site_users')
    and site_id is not null
    and it.is_site_member(site_id)
  );

-- ===========================================================================
-- Employee picker scoped to the caller's own sites — it.search_employees() is shared by the
-- unrestricted HR/IT-staff picker and the "add site IT staff" picker, neither of which should be
-- narrowed; this is a separate function rather than an added filter on that one.
-- ===========================================================================

create function it.search_employees_for_my_sites(p_search text)
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
  where has_permission('hr.offboarding.create_for_site_users')
    and p.person_type = 'employee'
    and p.site_id in (select site_id from it.site_it_staff where person_id = current_person_id())
    and (
      coalesce(trim(p_search), '') = ''
      or p.full_name ilike '%' || trim(p_search) || '%'
      or p.employee_code ilike '%' || trim(p_search) || '%'
    )
  order by p.full_name
  limit 50;
$$;

revoke all on function it.search_employees_for_my_sites(text) from public;
grant execute on function it.search_employees_for_my_sites(text) to authenticated;

commit;
