-- Employee Portal — IT module (M2), Service Management track: Onboarding / Offboarding.
-- Replicated into the main sequence from
-- supabase/it-migrations/javaria/javaria_it_0002_onboarding_offboarding.sql (Javaria,
-- IT/javaria) — confirmed already live via direct inspection when IT/dev was reconciled
-- (every table, trigger, function and permission below checked against information_schema /
-- pg_proc / pg_trigger / permissions live), not re-run here.
--
-- Requirements: IT BRD §5.1 (onboarding), §5.2 (offboarding), §7.3 (checklist record), §8 SCR-04.
-- Data model: ERD v4 section E (onboarding_offboarding, checklist_items), mapped onto portal
-- conventions (persons instead of employees/users, org_units instead of locations/departments,
-- uuid keys). ERD additions, all required by the BRD process (plan §1.2 #8):
--   * new-joiner details stored on the request — the person usually has no persons row yet;
--     person_id is linked when IT creates the portal account (BRD §5.1.11)
--   * routing_team (BRD §5.2.4), employee confirmation (§5.1.13), IT Executive + HOD IT
--     sign-off (§5.2.13–14), checklist completion gate (§5.2.12)
--   * it.onboarding_updates — per-request timeline (same reason as it.ticket_updates: non-admins
--     can't write public.audit_log)
--
-- Deliberately NOT stored: passwords. The BRD's credential emails (§5.1.10, §5.1.12) include a
-- temporary password; keeping one in the database is a credential leak waiting to happen. The
-- checklist records username / email address only; the password goes to the employee out of
-- band (and later via the Phase 5 notification, generated and sent, never persisted).
--
-- Asset steps: checklist_items.assignment_id will reference Talha's it.asset_assignments; the FK
-- is added in a later file once his Phase 3 is applied (07-it-inventory-plan.md §2.1). Until
-- then asset items record tag / serial / condition in `details`.
--
-- Status flow (automatic moves happen inside security-definer functions that set the
-- `it.lifecycle_system` flag; everything else is checked by it.lifecycle_before_update()):
--   Onboarding : Open -> Under Review -> In Progress -> Awaiting Confirmation -> Completed -> Closed
--   Offboarding: Open -> Under Review -> In Progress -> Pending Final Review -> Completed -> Closed
--   Replacement: Open -> Under Review -> In Progress -> Completed -> Closed
--   Any of Open / Under Review / In Progress -> Cancelled (with a reason)

-- ===========================================================================
-- PART A — Request types (it.request_types is owned by this track; see 0025_it_tickets.sql).
-- ===========================================================================

-- One type per kind, added only where none exists. The live DB already has New Joiner
-- (Onboarding), Exit (Offboarding) and Equipment Replacement (Replacement) — checked
-- 2026-10-12 — so nothing is inserted there. The app picks the active type for each kind.
insert into it.request_types (name, applies_to, description)
select v.name, v.applies_to, v.description
from (values
  ('New Joiner', 'Onboarding', 'New joiner: email, access, software, equipment and portal account'),
  ('Exit', 'Offboarding', 'Leaver: mailbox backup, access revocation and asset recovery'),
  ('Equipment Replacement', 'Replacement', 'Equipment replacement for an existing employee')
) as v(name, applies_to, description)
where not exists (select 1 from it.request_types rt where rt.applies_to = v.applies_to)
on conflict (name) do nothing;

-- ===========================================================================
-- PART B — Tables.
-- ===========================================================================

create table it.onboarding_offboarding (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique, -- ONB- / OFB- / RPL-, set by trigger
  request_type_id uuid not null references it.request_types(id),
  kind text not null check (kind in ('Onboarding', 'Offboarding', 'Replacement')),

  -- The employee. Required for offboarding / replacement (an existing person). For onboarding
  -- it's linked later, once the portal account exists (BRD §5.1.11).
  person_id uuid references public.persons(id),
  employee_name text not null check (length(trim(employee_name)) > 0),
  employee_code text,
  designation text,
  grade text,
  employee_category text check (employee_category in ('Permanent', 'Contractual')),
  company_id uuid references public.companies(id),
  site_id uuid references public.org_units(id),
  department_id uuid references public.org_units(id),
  reporting_manager_name text,
  personal_email text,

  joining_date date,
  last_working_date date,

  -- BRD §5.1.1 onboarding requirements / §5.2.2 known assets and accesses.
  laptop_required boolean not null default false,
  email_required boolean not null default true,
  access_required text,
  software_required text,
  known_assets_accesses text,

  priority text not null default 'Medium' check (priority in ('Critical', 'High', 'Medium', 'Low')),
  remarks text,

  -- BRD §5.2.4: head office -> IT HQ Team, any other site -> IT Plant Site Team. Set by trigger.
  routing_team text not null default 'IT HQ Team'
    check (routing_team in ('IT HQ Team', 'IT Plant Site Team')),
  it_executive_person_id uuid references public.persons(id),

  status text not null default 'Open' check (status in (
    'Open', 'Under Review', 'In Progress', 'Awaiting Confirmation', 'Pending Final Review',
    'Completed', 'Closed', 'Cancelled'
  )),
  due_date date, -- defaults to joining date / last working date
  requested_by uuid references public.persons(id),

  -- BRD §5.1.13 employee confirmation.
  email_confirmed boolean,
  access_confirmed boolean,
  software_confirmed boolean,
  asset_confirmed boolean,
  confirmation_notes text,
  employee_confirmed_at timestamptz,

  -- BRD §5.2.14 handover-takeover sign-off.
  executive_signed_by uuid references public.persons(id),
  executive_signed_at timestamptz,
  hod_signed_by uuid references public.persons(id),
  hod_signed_at timestamptz,

  completed_at timestamptz,
  closed_at timestamptz,
  cancelled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id),

  constraint onboarding_requires_joining_date
    check (kind <> 'Onboarding' or joining_date is not null),
  constraint offboarding_requires_exit_details
    check (kind <> 'Offboarding' or (last_working_date is not null and employee_category is not null)),
  constraint existing_employee_required
    check (kind = 'Onboarding' or person_id is not null)
);

create index onboarding_offboarding_status_idx on it.onboarding_offboarding (status);
create index onboarding_offboarding_kind_idx on it.onboarding_offboarding (kind);
create index onboarding_offboarding_person_idx on it.onboarding_offboarding (person_id);
create index onboarding_offboarding_requested_by_idx on it.onboarding_offboarding (requested_by);
create index onboarding_offboarding_created_at_idx on it.onboarding_offboarding (created_at desc);

create trigger onboarding_offboarding_set_updated_at
  before update on it.onboarding_offboarding
  for each row execute function public.set_updated_at();

-- ERD checklist_items. task_type drives what the task screen records in `details`:
--   email_account          {email_address, username}
--   access_provisioning    {accesses}            access_revocation  {accesses}
--   software_installation  {software}            license_deactivation {licenses}
--   asset_allocation / asset_return / hardware_recovery {asset_tag, serial_number, condition}
--   portal_account         {username}            email_backup_closure {backup_date, mailbox_status}
create table it.checklist_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references it.onboarding_offboarding(id) on delete cascade,
  task_type text not null check (task_type in (
    'email_account', 'access_provisioning', 'software_installation', 'asset_allocation',
    'portal_account', 'email_backup_closure', 'access_revocation', 'hardware_recovery',
    'asset_return', 'license_deactivation', 'other'
  )),
  task_name text not null check (length(trim(task_name)) > 0),
  sort_order int not null default 0,
  assigned_to_person_id uuid references public.persons(id),
  status text not null default 'Pending'
    check (status in ('Pending', 'In Progress', 'Completed', 'Not Applicable')),
  due_date date,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  notes text,
  assignment_id uuid, -- FK to it.asset_assignments added once Talha's Phase 3 is applied
  completed_at timestamptz,
  completed_by uuid references public.persons(id),
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index checklist_items_request_idx on it.checklist_items (request_id, sort_order);
create index checklist_items_assignee_idx on it.checklist_items (assigned_to_person_id);

create trigger checklist_items_set_updated_at
  before update on it.checklist_items
  for each row execute function public.set_updated_at();

create table it.onboarding_updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references it.onboarding_offboarding(id) on delete cascade,
  author_person_id uuid references public.persons(id),
  update_type text not null default 'comment' check (update_type in (
    'comment', 'work_note', 'status_change', 'task_update', 'sign_off', 'system'
  )),
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint onboarding_updates_work_note_internal check (update_type <> 'work_note' or is_internal)
);

create index onboarding_updates_request_idx on it.onboarding_updates (request_id, created_at);

-- ===========================================================================
-- PART C — Triggers.
-- ===========================================================================

-- BRD §5.2.4 routing. Security definer: org_units is admin-only under RLS.
create function it.routing_team_for_site(p_site_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_site_id is null then 'IT HQ Team'
    when (select site_type from org_units where id = p_site_id) = 'head_office' then 'IT HQ Team'
    else 'IT Plant Site Team'
  end;
$$;

revoke all on function it.routing_team_for_site(uuid) from public;
grant execute on function it.routing_team_for_site(uuid) to authenticated;

-- Security definer: HR can't read public.persons directly (admin-only RLS), but the request
-- must copy the leaver's identity from persons.
create function it.lifecycle_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_person record;
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

create trigger trg_lifecycle_before_insert
  before insert on it.onboarding_offboarding
  for each row execute function it.lifecycle_before_insert();

-- Default checklist per BRD §5.1.5 / §5.2.6. Security definer: HR raises the request but has
-- no insert rights on checklist_items.
create function it.lifecycle_seed_checklist()
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
      ('access_provisioning', 'User Access Provisioning', 20, true),
      ('software_installation', 'Software Installation & Device Configuration', 30, true),
      ('asset_allocation', 'Asset Allocation & Assignment Form', 40, new.laptop_required),
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

create trigger trg_lifecycle_seed_checklist
  after insert on it.onboarding_offboarding
  for each row execute function it.lifecycle_seed_checklist();

-- Manual changes are checked here; automatic status moves come from the security-definer
-- functions in Part E, which set it.lifecycle_system = 'on' for the duration of their update.
-- current_person_id() null = service role / SQL editor, already trusted.
create function it.lifecycle_before_update()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := public.current_person_id();
  v_system boolean := coalesce(current_setting('it.lifecycle_system', true), '') = 'on';
begin
  -- Immutable after creation.
  new.id := old.id;
  new.request_number := old.request_number;
  new.request_type_id := old.request_type_id;
  new.kind := old.kind;
  new.requested_by := old.requested_by;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.routing_team := case
    when new.site_id is distinct from old.site_id then it.routing_team_for_site(new.site_id)
    else old.routing_team
  end;

  if not v_system and v_actor is not null then
    if old.status in ('Completed', 'Closed', 'Cancelled')
       and not (old.status = 'Completed' and new.status = 'Closed') then
      raise exception 'This request is finished and read-only';
    end if;

    if new.email_confirmed is distinct from old.email_confirmed
       or new.access_confirmed is distinct from old.access_confirmed
       or new.software_confirmed is distinct from old.software_confirmed
       or new.asset_confirmed is distinct from old.asset_confirmed
       or new.employee_confirmed_at is distinct from old.employee_confirmed_at
       or new.executive_signed_by is distinct from old.executive_signed_by
       or new.executive_signed_at is distinct from old.executive_signed_at
       or new.hod_signed_by is distinct from old.hod_signed_by
       or new.hod_signed_at is distinct from old.hod_signed_at then
      raise exception 'Confirmation and sign-off can only be recorded through their own actions';
    end if;

    if new.person_id is distinct from old.person_id then
      raise exception 'Link the employee through the portal-account task';
    end if;

    if new.it_executive_person_id is distinct from old.it_executive_person_id
       and not public.has_permission('it.onboarding.assign') then
      raise exception 'Only IT executives can take ownership of a request';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'Open' and new.status = 'Under Review')
        or (new.status = 'Cancelled' and old.status in ('Open', 'Under Review', 'In Progress'))
        or (old.status = 'Completed' and new.status = 'Closed')
      ) then
        raise exception 'Status cannot be changed from % to % directly', old.status, new.status;
      end if;

      if new.status = 'Closed' and old.kind = 'Offboarding' then
        if not public.has_permission('it.onboarding.approve') then
          raise exception 'Only HOD IT can close offboarding requests';
        end if;
      elsif not public.has_permission('it.onboarding.assign') then
        raise exception 'Only IT executives can change the request status';
      end if;

      if new.status = 'Cancelled' and coalesce(trim(new.cancelled_reason), '') = '' then
        raise exception 'Please give a reason for cancelling';
      end if;
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'Completed' then
      new.completed_at := now();
    elsif new.status = 'Closed' then
      new.closed_at := now();
    elsif new.status = 'In Progress' and old.status in ('Awaiting Confirmation', 'Pending Final Review') then
      -- A checklist item was reopened: earlier confirmation / signatures no longer hold.
      new.executive_signed_by := null;
      new.executive_signed_at := null;
      new.hod_signed_by := null;
      new.hod_signed_at := null;
      new.employee_confirmed_at := null;
    end if;
  end if;

  new.updated_by := coalesce(v_actor, new.updated_by);
  return new;
end;
$$;

create trigger trg_lifecycle_before_update
  before update on it.onboarding_offboarding
  for each row execute function it.lifecycle_before_update();

create function it.log_lifecycle_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
    values (new.id, current_person_id(), 'status_change',
            format('Status changed from %s to %s', old.status, new.status)
              || case when new.status = 'Cancelled'
                      then ': ' || coalesce(new.cancelled_reason, '') else '' end);
  end if;
  if new.it_executive_person_id is distinct from old.it_executive_person_id
     and new.it_executive_person_id is not null then
    insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
    values (new.id, current_person_id(), 'system',
            format('IT Executive: %s',
                   (select full_name from persons where id = new.it_executive_person_id)));
  end if;
  if new.person_id is distinct from old.person_id and new.person_id is not null then
    insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
    values (new.id, current_person_id(), 'system', 'Employee portal account linked');
  end if;
  return null;
end;
$$;

create trigger trg_log_lifecycle_changes
  after update on it.onboarding_offboarding
  for each row execute function it.log_lifecycle_changes();

-- Checklist rules:
--   * reassigning needs it.onboarding.assign
--   * finished requests are read-only
--   * Not Applicable needs a note; the portal-account task needs the employee linked first
-- Security definer so the parent-request lookup works for every caller the update policy lets
-- through (has_permission / current_person_id still resolve to the caller).
create function it.checklist_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_person_id();
  v_request it.onboarding_offboarding%rowtype;
begin
  select * into v_request from it.onboarding_offboarding where id = new.request_id;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
  else
    new.request_id := old.request_id;
    new.task_type := old.task_type;
    new.created_by := old.created_by;
    new.created_at := old.created_at;

    if v_actor is not null
       and new.assigned_to_person_id is distinct from old.assigned_to_person_id
       and not public.has_permission('it.onboarding.assign') then
      raise exception 'Only IT executives can reassign checklist items';
    end if;
  end if;

  if v_actor is not null and v_request.status in ('Completed', 'Closed', 'Cancelled') then
    raise exception 'This request is finished and read-only';
  end if;

  if new.status = 'Not Applicable' and coalesce(trim(new.notes), '') = '' then
    raise exception 'Add a note explaining why "%" is not applicable', new.task_name;
  end if;

  if new.task_type = 'portal_account' and new.status = 'Completed'
     and v_request.person_id is null then
    raise exception 'Link the employee''s portal account before completing this task';
  end if;

  if new.status in ('Completed', 'Not Applicable') then
    if tg_op = 'INSERT' or old.status not in ('Completed', 'Not Applicable') then
      new.completed_at := now();
      new.completed_by := v_actor;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  return new;
end;
$$;

create trigger trg_checklist_items_before_write
  before insert or update on it.checklist_items
  for each row execute function it.checklist_items_before_write();

-- Moves the request along as its checklist fills in (BRD §5.2.12: final review only once every
-- item is done; onboarding waits for the employee's confirmation instead).
create function it.lifecycle_recalculate(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
  v_total int;
  v_open int;
  v_assigned int;
  v_target text;
begin
  select * into v_request from it.onboarding_offboarding where id = p_request_id for update;
  if not found or v_request.status in ('Completed', 'Closed', 'Cancelled') then
    return;
  end if;

  select count(*),
         count(*) filter (where status not in ('Completed', 'Not Applicable')),
         count(*) filter (where assigned_to_person_id is not null)
    into v_total, v_open, v_assigned
    from it.checklist_items where request_id = p_request_id;

  v_target := v_request.status;
  if v_total > 0 and v_open = 0 then
    v_target := case v_request.kind
      when 'Onboarding' then 'Awaiting Confirmation'
      when 'Offboarding' then 'Pending Final Review'
      else 'Completed'
    end;
  elsif v_request.status in ('Awaiting Confirmation', 'Pending Final Review')
        or (v_request.status in ('Open', 'Under Review') and v_assigned > 0) then
    v_target := 'In Progress';
  end if;

  if v_target is distinct from v_request.status then
    perform set_config('it.lifecycle_system', 'on', true);
    update it.onboarding_offboarding set status = v_target where id = p_request_id;
    perform set_config('it.lifecycle_system', 'off', true);
  end if;
end;
$$;

create function it.checklist_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if tg_op = 'DELETE' then
    v_request_id := old.request_id;
  else
    v_request_id := new.request_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
      values (new.request_id, current_person_id(), 'task_update',
              format('"%s" marked %s', new.task_name, new.status)
                || coalesce(': ' || nullif(trim(new.notes), ''), ''));
    end if;
    if new.assigned_to_person_id is distinct from old.assigned_to_person_id then
      insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
      values (new.request_id, current_person_id(), 'task_update',
              case when new.assigned_to_person_id is null
                   then format('"%s" unassigned', new.task_name)
                   else format('"%s" assigned to %s', new.task_name,
                               (select full_name from persons where id = new.assigned_to_person_id))
              end);
    end if;
  elsif tg_op = 'INSERT' and current_person_id() is not null
        and exists (select 1 from it.onboarding_updates where request_id = new.request_id) then
    -- Items added by hand after creation (the default checklist is logged as one line).
    insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
    values (new.request_id, current_person_id(), 'task_update',
            format('Task added: "%s"', new.task_name));
  end if;

  perform it.lifecycle_recalculate(v_request_id);
  return null;
end;
$$;

create trigger trg_checklist_items_after_write
  after insert or update or delete on it.checklist_items
  for each row execute function it.checklist_items_after_write();

-- ===========================================================================
-- PART D — Row Level Security.
--
--   HR (raise + track)       it.onboarding.create, it.onboarding.read
--   IT Team Member           it.onboarding.read, it.onboarding.update (tasks assigned to them)
--   IT Executive             it.onboarding.assign (own requests, assign tasks, cancel, close
--                            onboarding, sign as IT Executive)
--   HOD IT                   it.onboarding.approve (final review sign-off, close offboarding)
--   New joiner               sees their own onboarding request and confirms it (module:it)
-- ===========================================================================

alter table it.onboarding_offboarding enable row level security;
alter table it.checklist_items enable row level security;
alter table it.onboarding_updates enable row level security;

-- Security definer so the policy below can ask "am I assigned an item on this request?" without
-- checklist_items' RLS recursing back into onboarding_offboarding's.
create function it.is_lifecycle_assignee(p_request_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.checklist_items
    where request_id = p_request_id and assigned_to_person_id = current_person_id()
  );
$$;

revoke all on function it.is_lifecycle_assignee(uuid) from public;
grant execute on function it.is_lifecycle_assignee(uuid) to authenticated;

create policy "onboarding_offboarding select" on it.onboarding_offboarding
  for select to authenticated using (
    has_permission('it.onboarding.read')
    or requested_by = current_person_id()
    -- A leaver doesn't see their own offboarding record (it can be a termination); a new
    -- joiner does see their onboarding (BRD gap 4.1 #11, §5.1.13).
    or (kind = 'Onboarding' and person_id = current_person_id())
    or it.is_lifecycle_assignee(id)
  );

create policy "onboarding_offboarding insert by hr" on it.onboarding_offboarding
  for insert to authenticated with check (
    has_permission('it.onboarding.create') and requested_by = current_person_id()
  );

create policy "onboarding_offboarding update by it executive or hod" on it.onboarding_offboarding
  for update to authenticated
  using (has_permission('it.onboarding.assign') or has_permission('it.onboarding.approve'))
  with check (has_permission('it.onboarding.assign') or has_permission('it.onboarding.approve'));

-- No delete policy: requests are a permanent record; cancel instead.

create policy "checklist_items select" on it.checklist_items
  for select to authenticated using (
    has_permission('it.onboarding.read')
    or assigned_to_person_id = current_person_id()
    or exists (select 1 from it.onboarding_offboarding r where r.id = request_id)
  );

create policy "checklist_items insert by it executive" on it.checklist_items
  for insert to authenticated with check (has_permission('it.onboarding.assign'));

create policy "checklist_items update by assignee or executive" on it.checklist_items
  for update to authenticated
  using (
    has_permission('it.onboarding.assign')
    or (has_permission('it.onboarding.update') and assigned_to_person_id = current_person_id())
  )
  with check (has_permission('it.onboarding.assign') or has_permission('it.onboarding.update'));

create policy "checklist_items delete by it executive" on it.checklist_items
  for delete to authenticated using (has_permission('it.onboarding.assign'));

create policy "onboarding_updates select" on it.onboarding_updates
  for select to authenticated using (
    has_permission('it.onboarding.read')
    or (
      not is_internal
      and exists (select 1 from it.onboarding_offboarding r where r.id = request_id)
    )
  );

create policy "onboarding_updates insert comments and notes" on it.onboarding_updates
  for insert to authenticated with check (
    author_person_id = current_person_id()
    and update_type in ('comment', 'work_note')
    and exists (
      select 1 from it.onboarding_offboarding r
      where r.id = request_id and r.status not in ('Closed', 'Cancelled')
    )
    and (
      -- IT staff: comments or internal notes.
      has_permission('it.onboarding.update')
      or has_permission('it.onboarding.assign')
      or has_permission('it.onboarding.approve')
      -- HR / the new joiner: public comments only.
      or (update_type = 'comment' and not is_internal)
    )
  );

grant select, insert, update, delete on
  it.onboarding_offboarding, it.checklist_items, it.onboarding_updates
to authenticated;

-- ===========================================================================
-- PART E — Functions.
-- ===========================================================================

-- BRD §5.1.13: the new joiner confirms what they received. All confirmed -> Completed; anything
-- missing stays Awaiting Confirmation with a note IT can see.
create function it.confirm_onboarding(
  p_request_id uuid,
  p_email_ok boolean,
  p_access_ok boolean,
  p_software_ok boolean,
  p_asset_ok boolean,
  p_notes text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
  v_all_ok boolean;
begin
  select * into v_request from it.onboarding_offboarding
   where id = p_request_id and kind = 'Onboarding' and person_id = current_person_id()
   for update;
  if not found then
    raise exception 'Onboarding request not found';
  end if;
  if v_request.status <> 'Awaiting Confirmation' then
    raise exception 'This onboarding is not waiting for your confirmation';
  end if;

  v_all_ok := (not v_request.email_required or coalesce(p_email_ok, false))
          and coalesce(p_access_ok, false)
          and coalesce(p_software_ok, false)
          and (not v_request.laptop_required or coalesce(p_asset_ok, false));

  if not v_all_ok and coalesce(trim(p_notes), '') = '' then
    raise exception 'Please tell IT what is missing or not working';
  end if;

  perform set_config('it.lifecycle_system', 'on', true);
  update it.onboarding_offboarding
     set email_confirmed = p_email_ok,
         access_confirmed = p_access_ok,
         software_confirmed = p_software_ok,
         asset_confirmed = p_asset_ok,
         confirmation_notes = nullif(trim(p_notes), ''),
         employee_confirmed_at = case when v_all_ok then now() else null end,
         status = case when v_all_ok then 'Completed' else status end
   where id = p_request_id;
  perform set_config('it.lifecycle_system', 'off', true);

  insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
  values (p_request_id, current_person_id(),
          case when v_all_ok then 'system' else 'comment' end,
          case when v_all_ok
               then 'Employee confirmed everything is working'
               else 'Employee reported a problem: ' || trim(p_notes)
          end);

  return case when v_all_ok then 'Completed' else 'Awaiting Confirmation' end;
end;
$$;

-- BRD §5.2.13–5.2.14: handover-takeover sign-off. IT Executive signs first, then HOD IT, whose
-- signature completes the offboarding.
create function it.sign_offboarding(p_request_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
begin
  select * into v_request from it.onboarding_offboarding
   where id = p_request_id and kind = 'Offboarding'
   for update;
  if not found then
    raise exception 'Offboarding request not found';
  end if;
  if v_request.status <> 'Pending Final Review' then
    raise exception 'Every checklist item must be completed before sign-off';
  end if;

  perform set_config('it.lifecycle_system', 'on', true);

  if p_role = 'executive' then
    if not has_permission('it.onboarding.assign') then
      raise exception 'Only an IT Executive can sign here';
    end if;
    if v_request.executive_signed_at is not null then
      raise exception 'Already signed by the IT Executive';
    end if;
    update it.onboarding_offboarding
       set executive_signed_by = current_person_id(), executive_signed_at = now()
     where id = p_request_id;
  elsif p_role = 'hod' then
    if not has_permission('it.onboarding.approve') then
      raise exception 'Only HOD IT can give final approval';
    end if;
    if v_request.executive_signed_at is null then
      raise exception 'The IT Executive must sign first';
    end if;
    update it.onboarding_offboarding
       set hod_signed_by = current_person_id(), hod_signed_at = now(), status = 'Completed'
     where id = p_request_id;
  else
    raise exception 'Unknown sign-off role %', p_role;
  end if;

  perform set_config('it.lifecycle_system', 'off', true);

  insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
  values (p_request_id, current_person_id(), 'sign_off',
          case p_role
            when 'executive' then 'Handover-takeover signed by IT Executive'
            else 'Handover-takeover approved and signed by HOD IT'
          end);
end;
$$;

-- BRD §5.1.11: once the portal account exists (created on /admin/users), the IT member on the
-- portal-account task links it, so the new joiner can see and confirm their onboarding.
create function it.link_onboarding_person(p_request_id uuid, p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
begin
  select * into v_request from it.onboarding_offboarding
   where id = p_request_id and kind = 'Onboarding'
   for update;
  if not found then
    raise exception 'Onboarding request not found';
  end if;
  if v_request.status in ('Completed', 'Closed', 'Cancelled') then
    raise exception 'This request is finished and read-only';
  end if;
  if not (
    has_permission('it.onboarding.assign')
    or exists (
      select 1 from it.checklist_items
      where request_id = p_request_id
        and task_type = 'portal_account'
        and assigned_to_person_id = current_person_id()
    )
  ) then
    raise exception 'Only the IT Executive or the portal-account task owner can link the employee';
  end if;
  if not exists (select 1 from persons where id = p_person_id) then
    raise exception 'Employee not found';
  end if;

  perform set_config('it.lifecycle_system', 'on', true);
  update it.onboarding_offboarding
     set person_id = p_person_id,
         employee_code = coalesce((select employee_code from persons where id = p_person_id),
                                  employee_code)
   where id = p_request_id;
  perform set_config('it.lifecycle_system', 'off', true);
end;
$$;

-- Employee picker for HR (offboarding / replacement) and IT (linking a new joiner). Searches
-- public.persons, which these users can't read directly.
create function it.search_employees(p_search text)
returns table (
  person_id uuid,
  full_name text,
  employee_code text,
  designation text,
  site_id uuid,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.employee_code, p.designation, p.site_id, p.status
  from persons p
  where (has_permission('it.onboarding.create')
         or has_permission('it.onboarding.assign')
         or has_permission('it.onboarding.update'))
    and p.person_type = 'employee'
    and (
      coalesce(trim(p_search), '') = ''
      or p.full_name ilike '%' || trim(p_search) || '%'
      or p.employee_code ilike '%' || trim(p_search) || '%'
    )
  order by p.full_name
  limit 50;
$$;

-- People who can be given checklist items (hold it.onboarding.update).
create function it.list_onboarding_staff()
returns table (person_id uuid, full_name text, designation text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct p.id, p.full_name, p.designation
  from persons p
  join user_roles ur on ur.person_id = p.id
  join role_permissions rp on rp.role_id = ur.role_id
  join permissions perm on perm.id = rp.permission_id
  where perm.key = 'it.onboarding.update'
    and p.status = 'Active'
    and (has_permission('it.onboarding.read') or has_permission('it.onboarding.assign'))
  order by p.full_name;
$$;

-- it.person_names() from 0025_it_tickets.sql, widened so onboarding screens can show names too:
-- onboarding readers see anyone; requesters / new joiners see people on their own requests.
create or replace function it.person_names(p_person_ids uuid[])
returns table (person_id uuid, full_name text, designation text, employee_code text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.designation, p.employee_code
  from persons p
  where p.id = any (p_person_ids)
    and (
      has_permission('it.tickets.read')
      or has_permission('it.onboarding.read')
      or p.id = current_person_id()
      or exists (
        select 1 from it.tickets t
        where (t.requester_person_id = current_person_id()
               or t.requested_for_person_id = current_person_id())
          and (
            p.id in (t.assigned_to_person_id, t.requester_person_id, t.requested_for_person_id)
            or exists (
              select 1 from it.ticket_updates u
              where u.ticket_id = t.id and u.author_person_id = p.id and not u.is_internal
            )
          )
      )
      or exists (
        select 1 from it.onboarding_offboarding r
        where (r.requested_by = current_person_id()
               or (r.kind = 'Onboarding' and r.person_id = current_person_id())
               or it.is_lifecycle_assignee(r.id))
          and (
            p.id in (r.it_executive_person_id, r.requested_by, r.executive_signed_by,
                     r.hod_signed_by)
            or exists (
              select 1 from it.checklist_items c
              where c.request_id = r.id
                and (c.assigned_to_person_id = p.id or c.completed_by = p.id)
            )
            or exists (
              select 1 from it.onboarding_updates u
              where u.request_id = r.id and u.author_person_id = p.id and not u.is_internal
            )
          )
      )
    );
$$;

revoke all on function it.confirm_onboarding(uuid, boolean, boolean, boolean, boolean, text) from public;
revoke all on function it.sign_offboarding(uuid, text) from public;
revoke all on function it.link_onboarding_person(uuid, uuid) from public;
revoke all on function it.search_employees(text) from public;
revoke all on function it.list_onboarding_staff() from public;
revoke all on function it.lifecycle_recalculate(uuid) from public;
grant execute on function it.confirm_onboarding(uuid, boolean, boolean, boolean, boolean, text) to authenticated;
grant execute on function it.sign_offboarding(uuid, text) to authenticated;
grant execute on function it.link_onboarding_person(uuid, uuid) to authenticated;
grant execute on function it.search_employees(text) to authenticated;
grant execute on function it.list_onboarding_staff() to authenticated;
-- it.lifecycle_recalculate is internal (called by trigger only): no grant.

-- ===========================================================================
-- PART F — Permissions. Admin gets all of them; give them to HR / IT / HOD IT roles on
-- /admin/roles.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.onboarding.create', 'it', 'Raise Onboarding/Offboarding',
   'HR: raise onboarding, offboarding and replacement requests for IT'),
  ('it.onboarding.read', 'it', 'View Onboarding/Offboarding',
   'See every onboarding / offboarding request and its checklist'),
  ('it.onboarding.update', 'it', 'Work Onboarding/Offboarding Tasks',
   'Complete checklist items assigned to you; appear in the task assignee list'),
  ('it.onboarding.assign', 'it', 'Manage Onboarding/Offboarding',
   'IT Executive: own requests, assign checklist items, cancel, close onboarding, sign handover'),
  ('it.onboarding.approve', 'it', 'Final Review (HOD IT)',
   'HOD IT: final review and sign-off of offboarding, close offboarding requests')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null
from roles r
join permissions p on p.key in (
  'it.onboarding.create', 'it.onboarding.read', 'it.onboarding.update',
  'it.onboarding.assign', 'it.onboarding.approve'
)
where r.name = 'Admin'
on conflict do nothing;
