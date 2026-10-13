-- Employee Portal — IT module (M2), Service Management track: ticketing core. Replicated into
-- the main sequence from supabase/it-migrations/javaria/javaria_it_0001_tickets.sql (Javaria,
-- IT/javaria) — confirmed already live via direct inspection when IT/dev was reconciled
-- (every table, trigger, function and permission below checked against information_schema /
-- pg_proc / pg_trigger / permissions live), not re-run here.
--
-- Requirements: IT BRD §5.3 (To-Be ITSM process), §7.1 (IT Ticket Record), §8 SCR-01..03.
-- Data model: ERD v4 section B, mapped onto portal conventions per
-- 08-it-service-management-plan.md §1 (persons instead of users/employees, org_units instead
-- of departments/locations, uuid keys). ERD additions this file makes are listed in that plan's
-- §1.2 (subcategories, SLA table, timeline, attachments, escalation/satisfaction fields).
--
-- IT staff access uses it.* permission keys (plan §8 #1; same position as Talha's plan §8 #4a).
-- The live it.staff_roles table (Admin / IT Staff / Approver / Finance) is not read or changed
-- here — it predates both IT tracks, is unused by either, and is confirmed empty; a candidate
-- for a future cleanup migration, not addressed here.
--
-- tickets.linked_asset_id is a plain uuid for now. Its FK to it.assets is added in a later file
-- once Talha's assets migration exists (07-it-inventory-plan.md §2.1).

-- ===========================================================================
-- PART A — Master data.
-- ===========================================================================

-- it.request_types already exists (talha_it_0000: id, name unique, applies_to check in
-- ('Ticket','Onboarding','Offboarding','Replacement') — capitalised —, description, is_active,
-- created_at, updated_at). Kept as-is; this file brings it up to the SOP §7 conventions the
-- baseline flagged as missing (created_by / updated_by, updated_at trigger) and adds RLS.
-- Written to work whether or not any of that already exists live.
alter table it.request_types
  add column if not exists created_by uuid references public.persons(id),
  add column if not exists updated_by uuid references public.persons(id);

drop trigger if exists request_types_set_updated_at on it.request_types;
create trigger request_types_set_updated_at
  before update on it.request_types
  for each row execute function public.set_updated_at();

alter table it.request_types enable row level security;

drop policy if exists "request_types readable by authenticated" on it.request_types;
create policy "request_types readable by authenticated" on it.request_types
  for select to authenticated using (true);

drop policy if exists "request_types write by ticket settings" on it.request_types;
create policy "request_types write by ticket settings" on it.request_types
  for all to authenticated
  using (has_permission('it.ticket_settings.update'))
  with check (has_permission('it.ticket_settings.update'));

grant select, insert, update, delete on it.request_types to authenticated;

-- Defaults only for a database with no ticket types at all. The live DB already has its own
-- (Access Request, Email Issue, Hardware Issue, Network Issue, New Equipment, Software Issue —
-- checked 2026-10-12), which are kept as the real list; seeding BRD-style names on top would
-- create near-duplicates.
insert into it.request_types (name, applies_to, description)
select v.name, 'Ticket', v.description
from (values
  ('Incident', 'Something is broken or not working as expected'),
  ('Service Request', 'A request for a standard IT service (installation, setup, etc.)'),
  ('Access Request', 'Access to a system, application, folder, or account'),
  ('Asset Request', 'A request for new or replacement IT equipment')
) as v(name, description)
where not exists (select 1 from it.request_types where applies_to = 'Ticket')
on conflict (name) do nothing;

-- Category + subcategory in one self-referencing table (BRD §5.3.1 asks for both). parent_id
-- null = category; a row with a parent = subcategory. One level deep only.
create table it.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references it.ticket_categories(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_categories_name_unique unique nulls not distinct (parent_id, name)
);

create trigger ticket_categories_set_updated_at
  before update on it.ticket_categories
  for each row execute function public.set_updated_at();

create function it.enforce_category_depth()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null and exists (
    select 1 from it.ticket_categories where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'Subcategories cannot have their own subcategories';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_category_depth
  before insert or update on it.ticket_categories
  for each row execute function it.enforce_category_depth();

-- BRD §5.3.8: SLA applied automatically from priority. Wall-clock hours (24/7), not business
-- hours (plan §8 #4). Seed values are placeholders to confirm with IT (plan §8 #3).
create table it.sla_policies (
  priority text primary key check (priority in ('Critical', 'High', 'Medium', 'Low')),
  response_hours numeric(6, 2) not null check (response_hours > 0),
  resolution_hours numeric(6, 2) not null check (resolution_hours >= response_hours),
  updated_at timestamptz not null default now()
);

create trigger sla_policies_set_updated_at
  before update on it.sla_policies
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- PART B — Tickets.
-- ===========================================================================

create table it.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default it.next_number('IT'),

  requester_person_id uuid not null references public.persons(id),
  requested_for_person_id uuid references public.persons(id),

  request_type_id uuid not null references it.request_types(id),
  category_id uuid references it.ticket_categories(id),
  subcategory_id uuid references it.ticket_categories(id),
  priority text not null default 'Medium'
    check (priority in ('Critical', 'High', 'Medium', 'Low')),
  subject text not null check (length(trim(subject)) > 0),
  description text not null check (length(trim(description)) > 0),
  status text not null default 'Open'
    check (status in ('Open', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed')),
  assigned_to_person_id uuid references public.persons(id),

  -- BRD §5.3.1 form fields.
  linked_asset_id uuid, -- FK to it.assets added once Talha's assets migration exists
  asset_system_name text,
  access_required text,
  manager_approval_required boolean not null default false,
  preferred_contact_method text not null default 'Portal'
    check (preferred_contact_method in ('Portal', 'Email', 'Phone', 'Teams')),
  remarks text,

  -- Scoping (SOP §7). site_id / department_id come from the form (BRD "Location" /
  -- "Department"); company_id is copied from the requester's persons row at creation.
  company_id uuid references public.companies(id),
  site_id uuid references public.org_units(id),
  department_id uuid references public.org_units(id),

  -- SLA — computed by trigger from it.sla_policies, never set by the app.
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,

  -- Resolution & closure (BRD §5.3.12–5.3.15).
  resolution_notes text,
  root_cause text,
  resolved_at timestamptz,
  closed_at timestamptz,
  closure_remarks text,

  -- Escalation (BRD §5.3.11).
  is_escalated boolean not null default false,
  escalated_at timestamptz,
  escalated_by uuid references public.persons(id),
  escalation_reason text,

  -- Requester confirmation & satisfaction (BRD §5.3.14, gap 4.3 #15).
  reopen_count int not null default 0,
  requester_confirmed_at timestamptz,
  satisfaction_rating smallint check (satisfaction_rating between 1 and 5),
  satisfaction_comment text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create index tickets_requester_idx on it.tickets (requester_person_id);
create index tickets_requested_for_idx on it.tickets (requested_for_person_id);
create index tickets_assignee_idx on it.tickets (assigned_to_person_id);
create index tickets_status_idx on it.tickets (status);
create index tickets_created_at_idx on it.tickets (created_at desc);
create index tickets_linked_asset_idx on it.tickets (linked_asset_id);

create trigger tickets_set_updated_at
  before update on it.tickets
  for each row execute function public.set_updated_at();

-- Subcategory must belong to the chosen category; category must be top-level.
create function it.validate_ticket_category(p_category_id uuid, p_subcategory_id uuid)
returns void
language plpgsql
as $$
begin
  if p_category_id is not null and exists (
    select 1 from it.ticket_categories where id = p_category_id and parent_id is not null
  ) then
    raise exception 'Category must be a top-level category';
  end if;
  if p_subcategory_id is not null and (
    p_category_id is null
    or not exists (
      select 1 from it.ticket_categories
      where id = p_subcategory_id and parent_id = p_category_id
    )
  ) then
    raise exception 'Subcategory does not belong to the selected category';
  end if;
end;
$$;

-- New tickets always start in a clean state, whatever the client sent: the requester chooses
-- the content, never the workflow fields.
create function it.tickets_before_insert()
returns trigger
language plpgsql
as $$
declare
  v_sla it.sla_policies%rowtype;
begin
  perform it.validate_ticket_category(new.category_id, new.subcategory_id);

  new.created_at := now();
  new.created_by := coalesce(public.current_person_id(), new.created_by);
  new.updated_by := new.created_by;
  new.status := 'Open';
  new.assigned_to_person_id := null;
  new.first_responded_at := null;
  new.resolution_notes := null;
  new.root_cause := null;
  new.resolved_at := null;
  new.closed_at := null;
  new.closure_remarks := null;
  new.is_escalated := false;
  new.escalated_at := null;
  new.escalated_by := null;
  new.escalation_reason := null;
  new.reopen_count := 0;
  new.requester_confirmed_at := null;
  new.satisfaction_rating := null;
  new.satisfaction_comment := null;

  select * into v_sla from it.sla_policies where priority = new.priority;
  if found then
    new.response_due_at := new.created_at + v_sla.response_hours * interval '1 hour';
    new.resolution_due_at := new.created_at + v_sla.resolution_hours * interval '1 hour';
  else
    new.response_due_at := null;
    new.resolution_due_at := null;
  end if;

  return new;
end;
$$;

create trigger trg_tickets_before_insert
  before insert on it.tickets
  for each row execute function it.tickets_before_insert();

-- Workflow rules, enforced in the database rather than only hidden in the UI:
--   * assign / re-prioritise / escalate -> it.tickets.assign (IT Executive)
--   * close                             -> it.tickets.close
--   * resolve                           -> resolution notes required
--   * Closed is final and read-only
-- current_person_id() is null for service-role / SQL-editor sessions, which skip these gates
-- (already-trusted paths, same convention as the rest of the base).
create function it.tickets_before_update()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := public.current_person_id();
  v_sla it.sla_policies%rowtype;
begin
  if v_actor is not null and old.status = 'Closed' then
    raise exception 'Closed tickets are read-only';
  end if;

  -- Immutable after creation.
  new.id := old.id;
  new.ticket_number := old.ticket_number;
  new.requester_person_id := old.requester_person_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.response_due_at := old.response_due_at;
  new.resolution_due_at := old.resolution_due_at;

  if v_actor is not null then
    if (new.assigned_to_person_id is distinct from old.assigned_to_person_id
        or new.priority is distinct from old.priority
        or new.is_escalated is distinct from old.is_escalated)
       and not public.has_permission('it.tickets.assign') then
      raise exception 'Only IT executives can assign, re-prioritise, or escalate tickets';
    end if;
    if new.status = 'Closed' and old.status <> 'Closed'
       and not public.has_permission('it.tickets.close') then
      raise exception 'You do not have permission to close tickets';
    end if;
  end if;

  if new.category_id is distinct from old.category_id
     or new.subcategory_id is distinct from old.subcategory_id then
    perform it.validate_ticket_category(new.category_id, new.subcategory_id);
  end if;

  -- Re-prioritising re-baselines the SLA from the original submission time.
  if new.priority is distinct from old.priority then
    select * into v_sla from it.sla_policies where priority = new.priority;
    if found then
      new.response_due_at := old.created_at + v_sla.response_hours * interval '1 hour';
      new.resolution_due_at := old.created_at + v_sla.resolution_hours * interval '1 hour';
    end if;
  end if;

  -- Assigning an Open ticket moves it to Assigned; unassigning an Assigned one moves it back.
  if new.assigned_to_person_id is distinct from old.assigned_to_person_id
     and new.status = old.status then
    if new.assigned_to_person_id is not null and old.status = 'Open' then
      new.status := 'Assigned';
    elsif new.assigned_to_person_id is null and old.status = 'Assigned' then
      new.status := 'Open';
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'Open' and new.first_responded_at is null then
      new.first_responded_at := now();
    end if;

    if new.status = 'Resolved' then
      if coalesce(trim(new.resolution_notes), '') = '' then
        raise exception 'Resolution notes are required to resolve a ticket';
      end if;
      new.resolved_at := now();
      new.requester_confirmed_at := null;
    elsif new.status = 'Closed' then
      new.closed_at := now();
      new.resolved_at := coalesce(new.resolved_at, now());
    elsif old.status = 'Resolved' then
      -- Leaving Resolved for any working state is a reopen.
      new.reopen_count := old.reopen_count + 1;
      new.resolved_at := null;
      new.requester_confirmed_at := null;
    end if;
  end if;

  if new.is_escalated and not old.is_escalated then
    new.escalated_at := now();
    new.escalated_by := v_actor;
  elsif not new.is_escalated then
    new.escalated_at := null;
    new.escalated_by := null;
    new.escalation_reason := null;
  end if;

  new.updated_by := coalesce(v_actor, new.updated_by);
  return new;
end;
$$;

create trigger trg_tickets_before_update
  before update on it.tickets
  for each row execute function it.tickets_before_update();

-- ===========================================================================
-- PART C — Timeline, tasks, attachments.
-- ===========================================================================

-- BRD §5.3.9: every comment, work note and workflow change recorded against the ticket.
-- 'comment' is visible to the requester; 'work_note' is IT-internal; the other types are
-- written by triggers / functions, never inserted by the app directly.
create table it.ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references it.tickets(id) on delete cascade,
  author_person_id uuid references public.persons(id),
  update_type text not null default 'comment' check (update_type in (
    'comment', 'work_note', 'status_change', 'assignment', 'priority_change', 'escalation', 'system'
  )),
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ticket_updates_work_note_internal check (update_type <> 'work_note' or is_internal)
);

create index ticket_updates_ticket_idx on it.ticket_updates (ticket_id, created_at);

-- Security definer: the change was already authorized by tickets' RLS and the before-update
-- trigger; this only records it, and the actor may not satisfy ticket_updates' insert policy
-- (which is for manual comments only).
create function it.log_ticket_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
begin
  if new.status is distinct from old.status then
    insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'status_change',
            format('Status changed from %s to %s', old.status, new.status));
  end if;

  if new.assigned_to_person_id is distinct from old.assigned_to_person_id then
    insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'assignment',
            case
              when new.assigned_to_person_id is null then 'Ticket unassigned'
              else format('Assigned to %s',
                          (select full_name from persons where id = new.assigned_to_person_id))
            end);
  end if;

  if new.priority is distinct from old.priority then
    insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'priority_change',
            format('Priority changed from %s to %s', old.priority, new.priority));
  end if;

  if new.is_escalated and not old.is_escalated then
    insert into it.ticket_updates (ticket_id, author_person_id, update_type, body, is_internal)
    values (new.id, v_actor, 'escalation',
            'Ticket escalated' || coalesce(': ' || nullif(trim(new.escalation_reason), ''), ''),
            true);
  end if;

  return null;
end;
$$;

create trigger trg_log_ticket_changes
  after update on it.tickets
  for each row execute function it.log_ticket_changes();

-- The first public reply from IT counts as the first response (BRD §5.3.18).
create function it.mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.update_type = 'comment'
     and new.author_person_id is not null
     and (has_permission('it.tickets.update') or has_permission('it.tickets.assign')) then
    update it.tickets
       set first_responded_at = now()
     where id = new.ticket_id and first_responded_at is null;
  end if;
  return null;
end;
$$;

create trigger trg_mark_first_response
  after insert on it.ticket_updates
  for each row execute function it.mark_first_response();

-- ERD ticket_tasks: sub-tasks under a ticket, each with its own assignee and status.
create table it.ticket_tasks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references it.tickets(id) on delete cascade,
  assigned_to_person_id uuid references public.persons(id),
  task_type text not null check (length(trim(task_type)) > 0),
  description text,
  status text not null default 'Pending'
    check (status in ('Pending', 'In Progress', 'Completed', 'Cancelled')),
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ticket_tasks_ticket_idx on it.ticket_tasks (ticket_id);
create index ticket_tasks_assignee_idx on it.ticket_tasks (assigned_to_person_id);

create trigger ticket_tasks_set_updated_at
  before update on it.ticket_tasks
  for each row execute function public.set_updated_at();

create function it.ticket_tasks_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.current_person_id(), new.created_by);
  else
    new.ticket_id := old.ticket_id;
    new.created_by := old.created_by;
  end if;

  if new.status = 'Completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_ticket_tasks_before_write
  before insert or update on it.ticket_tasks
  for each row execute function it.ticket_tasks_before_write();

-- ERD tickets.attachment_path, generalised to many files per ticket. Files live in the private
-- bucket below at {ticket_id}/{random}-{filename}.
create table it.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references it.tickets(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);

create index ticket_attachments_ticket_idx on it.ticket_attachments (ticket_id);

-- ===========================================================================
-- PART D — Row Level Security.
--
--   Employee        module:it                 raise tickets; see/comment on their own
--   IT Team Member  it.tickets.read           see the whole queue
--                   it.tickets.update         work tickets assigned to them
--   IT Executive    it.tickets.assign         assign / prioritise / escalate any ticket
--                   it.tickets.close          formal closure
--   IT Admin        it.ticket_settings.update categories, request types, SLAs
-- ===========================================================================

alter table it.ticket_categories enable row level security;
alter table it.sla_policies enable row level security;
alter table it.tickets enable row level security;
alter table it.ticket_updates enable row level security;
alter table it.ticket_tasks enable row level security;
alter table it.ticket_attachments enable row level security;

create policy "ticket_categories readable by authenticated" on it.ticket_categories
  for select to authenticated using (true);
create policy "ticket_categories write by ticket settings" on it.ticket_categories
  for all to authenticated
  using (has_permission('it.ticket_settings.update'))
  with check (has_permission('it.ticket_settings.update'));

create policy "sla_policies readable by authenticated" on it.sla_policies
  for select to authenticated using (true);
create policy "sla_policies write by ticket settings" on it.sla_policies
  for all to authenticated
  using (has_permission('it.ticket_settings.update'))
  with check (has_permission('it.ticket_settings.update'));

create policy "tickets select own, assigned, or it staff" on it.tickets
  for select to authenticated using (
    requester_person_id = current_person_id()
    or requested_for_person_id = current_person_id()
    or assigned_to_person_id = current_person_id()
    or has_permission('it.tickets.read')
  );

create policy "tickets insert own" on it.tickets
  for insert to authenticated with check (
    requester_person_id = current_person_id() and has_permission('module:it')
  );

-- Team members update only tickets assigned to them; executives update any. Which columns each
-- may change is enforced by it.tickets_before_update(). Requester actions (confirm / reopen) go
-- through the security-definer functions in Part E instead of an update policy.
create policy "tickets update by it staff" on it.tickets
  for update to authenticated
  using (
    has_permission('it.tickets.assign')
    or (has_permission('it.tickets.update') and assigned_to_person_id = current_person_id())
  )
  with check (has_permission('it.tickets.assign') or has_permission('it.tickets.update'));

-- No delete policy: tickets are a permanent record (BRD §5.3.15).

-- The exists() subqueries below are themselves filtered by it.tickets' RLS, so "exists" means
-- "a ticket this caller is allowed to see".
create policy "ticket_updates select" on it.ticket_updates
  for select to authenticated using (
    has_permission('it.tickets.read')
    or (
      not is_internal
      and exists (select 1 from it.tickets t where t.id = ticket_id)
    )
  );

create policy "ticket_updates insert comments and notes" on it.ticket_updates
  for insert to authenticated with check (
    author_person_id = current_person_id()
    and update_type in ('comment', 'work_note')
    and (
      -- IT staff: public comments or internal work notes on any non-closed ticket they can see.
      (
        (has_permission('it.tickets.update') or has_permission('it.tickets.assign'))
        and exists (select 1 from it.tickets t where t.id = ticket_id and t.status <> 'Closed')
      )
      -- Requester: public comments on their own non-closed ticket.
      or (
        update_type = 'comment'
        and not is_internal
        and exists (
          select 1 from it.tickets t
          where t.id = ticket_id
            and t.status <> 'Closed'
            and (t.requester_person_id = current_person_id()
                 or t.requested_for_person_id = current_person_id())
        )
      )
    )
  );

create policy "ticket_tasks select" on it.ticket_tasks
  for select to authenticated using (
    has_permission('it.tickets.read') or assigned_to_person_id = current_person_id()
  );

create policy "ticket_tasks insert by it staff" on it.ticket_tasks
  for insert to authenticated with check (
    (has_permission('it.tickets.update') or has_permission('it.tickets.assign'))
    and exists (select 1 from it.tickets t where t.id = ticket_id and t.status <> 'Closed')
  );

create policy "ticket_tasks update by assignee or executive" on it.ticket_tasks
  for update to authenticated
  using (
    has_permission('it.tickets.assign')
    or (has_permission('it.tickets.update') and assigned_to_person_id = current_person_id())
  )
  with check (has_permission('it.tickets.assign') or has_permission('it.tickets.update'));

create policy "ticket_tasks delete by executive" on it.ticket_tasks
  for delete to authenticated using (has_permission('it.tickets.assign'));

create policy "ticket_attachments select" on it.ticket_attachments
  for select to authenticated using (
    exists (select 1 from it.tickets t where t.id = ticket_id)
  );

create policy "ticket_attachments insert" on it.ticket_attachments
  for insert to authenticated with check (
    uploaded_by = current_person_id()
    and exists (select 1 from it.tickets t where t.id = ticket_id and t.status <> 'Closed')
  );

-- Grants for this file's tables only (not `all tables in schema it` — the pre-existing tables'
-- grants are Talha's baseline to decide).
grant select, insert, update, delete on
  it.ticket_categories, it.sla_policies, it.tickets, it.ticket_updates, it.ticket_tasks,
  it.ticket_attachments
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage for attachments. Access follows the ticket: anyone who can see the ticket (under
-- it.tickets' RLS) can read its files and, until it's Closed, add more. 5 MB per file,
-- matching the app-side check.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('it-ticket-attachments', 'it-ticket-attachments', false, 5242880)
on conflict (id) do nothing;

create policy "it-ticket-attachments select via ticket" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'it-ticket-attachments'
    and exists (
      select 1 from it.tickets t where t.id::text = (storage.foldername(name))[1]
    )
  );

create policy "it-ticket-attachments insert via open ticket" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'it-ticket-attachments'
    and exists (
      select 1 from it.tickets t
      where t.id::text = (storage.foldername(name))[1] and t.status <> 'Closed'
    )
  );

-- ===========================================================================
-- PART E — Functions.
-- ===========================================================================

-- Requester confirms the fix (BRD §5.3.14). Security definer because requesters have no update
-- policy on it.tickets; this is the one narrow change they're allowed to make.
create function it.confirm_ticket_resolution(
  p_ticket_id uuid,
  p_rating smallint,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  update it.tickets
     set requester_confirmed_at = now(),
         satisfaction_rating = p_rating,
         satisfaction_comment = nullif(trim(p_comment), '')
   where id = p_ticket_id
     and status = 'Resolved'
     and requester_confirmed_at is null
     and (requester_person_id = current_person_id()
          or requested_for_person_id = current_person_id());
  if not found then
    raise exception 'Ticket not found or not awaiting your confirmation';
  end if;

  insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
  values (p_ticket_id, current_person_id(), 'system',
          format('Requester confirmed the resolution (rating %s/5)', p_rating));
end;
$$;

-- Requester says the fix didn't work (BRD §5.3.14). Goes back to the assignee if there is one,
-- otherwise back to the queue.
create function it.reopen_ticket(p_ticket_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Please say why the ticket is being reopened';
  end if;

  update it.tickets
     set status = case when assigned_to_person_id is null then 'Open' else 'In Progress' end
   where id = p_ticket_id
     and status = 'Resolved'
     and (requester_person_id = current_person_id()
          or requested_for_person_id = current_person_id());
  if not found then
    raise exception 'Only resolved tickets you raised can be reopened';
  end if;

  insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
  values (p_ticket_id, current_person_id(), 'comment', 'Reopened: ' || trim(p_reason));
end;
$$;

-- public.persons and public.org_units are readable only by the person themself / admins. These
-- functions expose the minimum the IT screens need without loosening those base policies
-- (plan §1.3).

-- People who can be assigned tickets / tasks (hold it.tickets.update). Visible to IT staff only.
create function it.list_it_staff()
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
  where perm.key = 'it.tickets.update'
    and p.status = 'Active'
    and has_permission('it.tickets.read')
  order by p.full_name;
$$;

-- Display names for people on tickets. IT staff can resolve anyone; everyone else only people
-- connected to their own tickets (assignee, public comment authors) and themselves.
create function it.person_names(p_person_ids uuid[])
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
    );
$$;

-- Active sites and departments for the ticket form's Location / Department pickers, and for
-- showing those names on tickets.
create function it.list_org_units()
returns table (id uuid, name text, type text)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.name, o.type
  from org_units o
  where o.is_active and has_permission('module:it')
  order by o.type, o.name;
$$;

revoke all on function it.confirm_ticket_resolution(uuid, smallint, text) from public;
revoke all on function it.reopen_ticket(uuid, text) from public;
revoke all on function it.list_it_staff() from public;
revoke all on function it.person_names(uuid[]) from public;
revoke all on function it.list_org_units() from public;
grant execute on function it.confirm_ticket_resolution(uuid, smallint, text) to authenticated;
grant execute on function it.reopen_ticket(uuid, text) to authenticated;
grant execute on function it.list_it_staff() to authenticated;
grant execute on function it.person_names(uuid[]) to authenticated;
grant execute on function it.list_org_units() to authenticated;

-- ===========================================================================
-- PART F — Seed data (placeholders to confirm with IT; editable later in Phase 2's settings).
-- ===========================================================================

-- Categories from BRD §5.3.5; subcategories from the common requests in BRD §2.4.3.
insert into it.ticket_categories (name, sort_order) values
  ('Hardware Support', 10),
  ('Software Support', 20),
  ('Network Support', 30),
  ('Access Management', 40),
  ('Email & Collaboration', 50),
  ('Printer & Peripherals', 60),
  ('Asset Management', 70),
  ('Change Request', 80),
  ('Other', 90);

insert into it.ticket_categories (parent_id, name, sort_order)
select c.id, s.name, s.sort_order
from (values
  ('Hardware Support', 'Laptop / Desktop', 10),
  ('Hardware Support', 'Monitor / Accessories', 20),
  ('Hardware Support', 'Mobile Device', 30),
  ('Software Support', 'Software Installation', 10),
  ('Software Support', 'Application Error', 20),
  ('Software Support', 'ERP Issue', 30),
  ('Software Support', 'License Request', 40),
  ('Network Support', 'Network Connectivity', 10),
  ('Network Support', 'Internet Access', 20),
  ('Network Support', 'VPN', 30),
  ('Access Management', 'Password Reset', 10),
  ('Access Management', 'User / System Account', 20),
  ('Access Management', 'Shared Folder Access', 30),
  ('Access Management', 'Application Access', 40),
  ('Email & Collaboration', 'Outlook / Email', 10),
  ('Email & Collaboration', 'Microsoft Teams', 20),
  ('Email & Collaboration', 'SharePoint / OneDrive', 30),
  ('Printer & Peripherals', 'Printer', 10),
  ('Printer & Peripherals', 'Scanner', 20)
) as s(parent_name, name, sort_order)
join it.ticket_categories c on c.name = s.parent_name and c.parent_id is null;

insert into it.sla_policies (priority, response_hours, resolution_hours) values
  ('Critical', 1, 4),
  ('High', 2, 8),
  ('Medium', 4, 24),
  ('Low', 8, 72);

-- ===========================================================================
-- PART G — Permissions. Staff permissions go to Admin only; assign them to IT roles on
-- /admin/roles (module:it is registered in 0024_it_foundation.sql).
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.tickets.read', 'it', 'View IT Ticket Queue',
   'See every IT ticket across the organization, including internal work notes'),
  ('it.tickets.update', 'it', 'Work on IT Tickets',
   'Update status, add work notes, resolve, and manage tasks on tickets assigned to you; appear in the assignee list'),
  ('it.tickets.assign', 'it', 'Assign & Prioritise IT Tickets',
   'Assign any ticket, change priority, and escalate (IT Executive)'),
  ('it.tickets.close', 'it', 'Close IT Tickets',
   'Formally close tickets after resolution'),
  ('it.ticket_settings.update', 'it', 'Ticket Settings',
   'Maintain ticket categories, request types, and SLA targets')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null
from roles r
join permissions p on p.key in (
  'it.tickets.read', 'it.tickets.update', 'it.tickets.assign', 'it.tickets.close',
  'it.ticket_settings.update'
)
where r.name = 'Admin'
on conflict do nothing;
