-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Offboarding / replacement — pick the employee, details fill themselves
--              (08-it-service-management-plan.md; BRD §5.2.1)
-- Depends on:  javaria_it_0002_onboarding_offboarding.sql, javaria_it_0005_site_routing.sql
-- Applied to live DB: YES (confirmed live 2026-10-30 by read-only check)
--
-- One read-only lookup for the employee picker (HR's new offboarding / replacement form) and the
-- employee's own "Request offboarding" page:
--   * p_search  → up to 10 employees matching name or employee code (type-ahead);
--   * p_person_id → that one employee (the card after picking).
-- Returns what the request card shows: code, name, designation, company, location, category,
-- joining date, contract end date, status.
--
-- Access: the same people who can already search employees for onboarding / offboarding
-- (it.onboarding.create / .assign / .update, it.ticket_settings.update), plus anyone looking up
-- THEMSELVES (p_person_id = their own person). public.persons, companies and org_units stay
-- unreadable directly — security definer, minimum columns.
--
-- Employee category: persons.employment_type uses permanent / contractual_with_email /
-- contractual_no_email / third_party_vendor; the request form uses Permanent / Contractual.
-- Mapped here: permanent → Permanent, the rest → Contractual, empty → null (HR picks).

create function it.employee_lookup(p_search text default null, p_person_id uuid default null)
returns table (
  person_id uuid,
  full_name text,
  employee_code text,
  designation text,
  company_name text,
  site_id uuid,
  site_name text,
  employment_type text,
  employee_category text,
  date_of_joining date,
  contract_end_date date,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.employee_code, p.designation,
         c.name, p.site_id, s.name,
         p.employment_type,
         case
           when p.employment_type = 'permanent' then 'Permanent'
           when p.employment_type in ('contractual_with_email', 'contractual_no_email', 'third_party_vendor')
             then 'Contractual'
         end,
         p.date_of_joining, p.contract_end_date, p.status
  from persons p
  left join companies c on c.id = p.company_id
  left join org_units s on s.id = p.site_id
  where p.person_type = 'employee'
    and (
      (p_person_id is not null and p.id = p_person_id
         and (p.id = current_person_id()
              or has_permission('it.onboarding.create')
              or has_permission('it.onboarding.assign')
              or has_permission('it.onboarding.update')
              or has_permission('it.ticket_settings.update')))
      or (p_person_id is null
          and length(trim(coalesce(p_search, ''))) >= 2
          and (has_permission('it.onboarding.create')
               or has_permission('it.onboarding.assign')
               or has_permission('it.onboarding.update')
               or has_permission('it.ticket_settings.update'))
          and (p.full_name ilike '%' || trim(p_search) || '%'
               or p.employee_code ilike '%' || trim(p_search) || '%'))
    )
  order by (p.status = 'Active') desc, p.full_name
  limit 10;
$$;

revoke all on function it.employee_lookup(text, uuid) from public;
grant execute on function it.employee_lookup(text, uuid) to authenticated;
