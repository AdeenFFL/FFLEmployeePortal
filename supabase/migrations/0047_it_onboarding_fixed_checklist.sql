-- Employee Portal — IT module: fixed onboarding checklist (license assignment + split access
-- tasks + a distinct asset-handover confirmation step) and a new rule tying offboarding
-- eligibility to a completed onboarding record in this system. Existing employees who predate
-- this system (zero onboarding records) are grandfathered — the rule only binds people the
-- system itself onboarded.

begin;

-- ---------------------------------------------------------------------------
-- Part 1 — two new checklist task types.
-- ---------------------------------------------------------------------------

alter table it.checklist_items drop constraint checklist_items_task_type_check;
alter table it.checklist_items add constraint checklist_items_task_type_check check (task_type in (
  'email_account', 'access_provisioning', 'software_installation', 'asset_allocation',
  'asset_handover', 'portal_account', 'email_backup_closure', 'access_revocation',
  'hardware_recovery', 'asset_return', 'license_assignment', 'license_deactivation', 'other'
));

-- ---------------------------------------------------------------------------
-- Part 2 — it.lifecycle_before_insert(): add the offboarding-eligibility guard, right after the
-- existing "employee not found" check. Everything else in this function is unchanged from
-- 0027_it_onboarding_offboarding.sql.
-- ---------------------------------------------------------------------------

create or replace function it.lifecycle_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_person record;
  v_onboarding_total int;
  v_onboarding_completed int;
begin
  select applies_to into v_kind from it.request_types where id = new.request_type_id;
  if v_kind is null or v_kind not in ('Onboarding', 'Offboarding', 'Replacement') then
    raise exception 'Request type must be an onboarding, offboarding or replacement type';
  end if;
  new.kind := v_kind;

  -- An existing employee's identity comes from persons, not from the form.
  if new.person_id is not null then
    select full_name, employee_code, designation, company_id, site_id
      into v_person
      from persons where id = new.person_id;
    if not found then
      raise exception 'Employee not found';
    end if;
    new.employee_name := v_person.full_name;
    new.employee_code := coalesce(v_person.employee_code, new.employee_code);
    new.designation := coalesce(nullif(trim(new.designation), ''), v_person.designation);
    new.company_id := coalesce(new.company_id, v_person.company_id);
    new.site_id := coalesce(new.site_id, v_person.site_id);

    -- Offboarding is only raisable for someone whose onboarding in THIS system is complete.
    -- Zero onboarding records at all (someone who predates this system) is grandfathered
    -- through, not blocked. Covers both the HR-initiated and self-service insert paths, since
    -- both insert through this same trigger.
    if new.kind = 'Offboarding' then
      select count(*), count(*) filter (where status in ('Completed', 'Closed'))
        into v_onboarding_total, v_onboarding_completed
        from it.onboarding_offboarding
        where person_id = new.person_id and kind = 'Onboarding';
      if v_onboarding_total > 0 and v_onboarding_completed = 0 then
        raise exception 'This employee''s onboarding must be completed before they can be offboarded.';
      end if;
    end if;
  end if;

  new.routing_team := it.routing_team_for_site(new.site_id);

  new.request_number := it.next_number(case new.kind
    when 'Onboarding' then 'ONB'
    when 'Offboarding' then 'OFB'
    else 'RPL'
  end);
  new.due_date := coalesce(new.due_date, case new.kind
    when 'Onboarding' then new.joining_date
    when 'Offboarding' then new.last_working_date
  end);

  -- Workflow fields always start clean.
  new.status := 'Open';
  new.it_executive_person_id := null;
  new.email_confirmed := null;
  new.access_confirmed := null;
  new.software_confirmed := null;
  new.asset_confirmed := null;
  new.confirmation_notes := null;
  new.employee_confirmed_at := null;
  new.executive_signed_by := null;
  new.executive_signed_at := null;
  new.hod_signed_by := null;
  new.hod_signed_at := null;
  new.completed_at := null;
  new.closed_at := null;
  new.cancelled_reason := null;

  new.created_at := now();
  new.requested_by := current_person_id();
  new.created_by := new.requested_by;
  new.updated_by := new.requested_by;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Part 3 — it.lifecycle_seed_checklist(): Onboarding branch gets license_assignment and
-- asset_handover added, and the generic always-on access_provisioning row removed (replaced by
-- app-layer logic in createLifecycleRequest that creates one row per line of the "access
-- required" field — see app/(protected)/it/onboarding/actions.ts). Offboarding/Replacement
-- branches are unchanged.
-- ---------------------------------------------------------------------------

create or replace function it.lifecycle_seed_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'Onboarding' then
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    select new.id, t.task_type, t.task_name, t.sort_order, new.due_date
    from (values
      ('email_account', 'Email Account Creation', 10, new.email_required),
      ('license_assignment', 'Software License Assignment', 15, new.email_required),
      ('software_installation', 'Software Installation & Device Configuration', 30, true),
      ('asset_allocation', 'Asset Allocation & Assignment Form', 40, new.laptop_required),
      ('asset_handover', 'Asset Handover Confirmation', 45, new.laptop_required),
      ('portal_account', 'Employee Portal Account Creation', 50, true)
    ) as t(task_type, task_name, sort_order, include)
    where t.include;
  elsif new.kind = 'Offboarding' then
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    select new.id, t.task_type, t.task_name, t.sort_order, new.due_date
    from (values
      ('email_backup_closure', 'Email Backup & Account Closure', 10),
      ('access_revocation', 'User Access Revocation', 20),
      ('hardware_recovery', 'Laptop & Hardware Recovery', 30),
      ('asset_return', 'Asset Return Form', 40),
      ('license_deactivation', 'Software License Deactivation', 50)
    ) as t(task_type, task_name, sort_order);
  else
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    values
      (new.id, 'asset_return', 'Return Old Asset', 10, new.due_date),
      (new.id, 'asset_allocation', 'Issue Replacement Asset', 20, new.due_date);
  end if;

  insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
  values (new.id, new.requested_by, 'system',
          format('%s request %s raised for %s', new.kind, new.request_number, new.employee_name));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Part 4 — it.search_employees(): add an onboarding_cleared column (UX nicety, not an
-- enforcement mechanism — the trigger above is what actually enforces the rule). Rows are NOT
-- filtered out, since this function is also shared by the unrelated "add site IT staff" picker
-- (/it/settings/sites) where onboarding status is meaningless.
-- ---------------------------------------------------------------------------

-- Return shape is changing (new onboarding_cleared column), which Postgres won't allow via
-- CREATE OR REPLACE on a RETURNS TABLE function — drop and recreate instead.
drop function it.search_employees(text);

create function it.search_employees(p_search text)
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
    -- Mirrors it.lifecycle_before_insert()'s guard exactly: cleared if they have zero onboarding
    -- records at all (grandfathered), or at least one completed one — NOT "every record is
    -- completed", since the trigger only blocks on zero-completed, not partial-incomplete.
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
         or has_permission('it.ticket_settings.update'))
    and p.person_type = 'employee'
    and (
      coalesce(trim(p_search), '') = ''
      or p.full_name ilike '%' || trim(p_search) || '%'
      or p.employee_code ilike '%' || trim(p_search) || '%'
    )
  order by p.full_name
  limit 50;
$$;

revoke all on function it.search_employees(text) from public;
grant execute on function it.search_employees(text) to authenticated;

commit;
