-- Employee Portal — IT module: department-based IT staff. Replaces the "search any employee and
-- add them to a site" flow with "IT staff is automatically whoever is in the IT department";
-- the only thing still manually configured per person is WHICH site(s) they cover
-- (it.site_it_staff keeps that role, unchanged in shape — just gated to IT-department people).
--
-- persons has no department field at all today (confirmed: only site_id/company_id) — this adds
-- a real one, FK'd to org_units the same way site_id already is, reusing the existing
-- /admin/departments screen (already a complete org_units type='Department' CRUD, nothing missing
-- there) instead of inventing a parallel departments table.
--
-- "IT department" is identified by name match (org_units.name = 'IT', case/whitespace-insensitive)
-- rather than a dedicated flag — deliberate: we just removed one similar singleton-config concept
-- (HQ site) at the user's request; one more name-matched lookup is a smaller footprint than a new
-- config table for a single row. If "IT" ever gets renamed, this silently stops matching — flagged
-- here, not hidden.
--
-- Rollout note: persons.department_id starts NULL for everyone, so every EXISTING it.site_it_staff
-- row's person will fail the new department check on their next edit (existing rows aren't
-- deleted — the trigger only fires on insert/update) until their department is set via
-- Admin -> Users.

begin;

alter table public.persons add column department_id uuid references public.org_units(id);
create index persons_department_idx on public.persons (department_id);

-- Legacy invited_users.department/site stay as-is (free text, unused going forward, not dropped —
-- out of scope). This is the new FK sibling, populated going forward by the Admin -> Users form
-- and the onboarding flow, and copied onto persons.department_id when the invite becomes a real
-- account (app/auth/callback/route.ts).
alter table public.invited_users add column department_id uuid references public.org_units(id);

create function it.is_it_department(p_person_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from persons p
    join org_units o on o.id = p.department_id
    where p.id = p_person_id and lower(trim(o.name)) = 'it'
  );
$$;

revoke all on function it.is_it_department(uuid) from public;
grant execute on function it.is_it_department(uuid) to authenticated;

-- Real enforcement boundary — the UI just stops OFFERING anyone else; this is what actually
-- blocks a non-IT person from ever landing in it.site_it_staff, however the row is written.
create function it.check_site_it_staff_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not it.is_it_department(new.person_id) then
    raise exception 'Only people in the IT department can be added to a site''s IT team';
  end if;
  return new;
end;
$$;

create trigger trg_check_site_it_staff_department
  before insert or update on it.site_it_staff
  for each row execute function it.check_site_it_staff_department();

-- Lists everyone eligible for site assignment (IT department), for the new person-centric
-- management screen — mirrors it.list_site_it_staff's shape.
create function it.list_it_department_staff()
returns table (person_id uuid, full_name text, designation text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.designation
  from persons p
  join org_units o on o.id = p.department_id
  where p.status = 'Active'
    and lower(trim(o.name)) = 'it'
    and (has_permission('it.ticket_settings.update') or has_permission('it.tickets.read'))
  order by p.full_name;
$$;

revoke all on function it.list_it_department_staff() from public;
grant execute on function it.list_it_department_staff() to authenticated;

commit;
