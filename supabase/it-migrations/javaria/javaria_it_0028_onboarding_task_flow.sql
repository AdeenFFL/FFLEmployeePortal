-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Onboarding / offboarding / replacement task flow (2026-11-19).
--              1. No task left unassigned. A checklist task goes to the primary owner of its task
--                 type for the request's site (IT Settings → Onboarding Tasks); when there is none,
--                 to the request's IT Executive. When a request gets its IT Executive later (Pick up
--                 / Take over), its open unassigned tasks go to them. They hand each on with Assign.
--              2. One message, not one per task: tasks that fall to the IT Executive this way don't
--                 each send "Task assigned". Instead the IT Executive gets one message saying the
--                 request is theirs and how many tasks are waiting. Assigning a task by hand, or to
--                 its owner from Settings, still tells that person, as before.
--              3. Task done (Completed or Not Applicable) → the IT Executive is told; with no IT
--                 Executive yet, everyone who can assign onboarding work. Nobody is told about their
--                 own action.
-- Depends on:  0048_it_task_type_owners.sql, 0052_it_onboarding_site_scoping.sql,
--              javaria_it_0003_notifications.sql
-- Applied to live DB: NO
--
-- Functions REPLACED: it.auto_assign_checklist_item, it.notify_checklist_assignment.
-- New: it.assign_open_tasks_to_executive, it.notify_checklist_done (+ their triggers).
-- Session flag: it.task_fallback = 'on' while tasks are handed to the IT Executive automatically.

begin;

-- ===========================================================================
-- 1. A new task: the site's owner for its type, else the request's IT Executive.
-- ===========================================================================

create or replace function it.auto_assign_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_type text;
  v_request_id uuid;
  v_site_id uuid;
  v_executive uuid;
  v_owner uuid;
begin
  select task_type, request_id into v_task_type, v_request_id
  from it.checklist_items where id = p_item_id and assigned_to_person_id is null;
  if not found then
    return;
  end if;

  select site_id, it_executive_person_id into v_site_id, v_executive
  from it.onboarding_offboarding where id = v_request_id;

  if v_site_id is not null then
    select o.person_id into v_owner
    from it.task_type_owners o
    join persons p on p.id = o.person_id and p.status = 'Active'
    where o.task_type = v_task_type and o.site_id = v_site_id and o.is_primary;
  end if;

  if v_owner is not null then
    -- The configured owner: told as usual (it.notify_checklist_assignment).
    update it.checklist_items set assigned_to_person_id = v_owner where id = p_item_id;
  elsif v_executive is not null then
    -- Falls to the IT Executive: no per-task message (see 2).
    perform set_config('it.task_fallback', 'on', true);
    update it.checklist_items set assigned_to_person_id = v_executive where id = p_item_id;
    perform set_config('it.task_fallback', 'off', true);
  end if;
end;
$$;

-- ===========================================================================
-- 2. The request gets an IT Executive: its open, unassigned tasks become theirs, and they get one
--    message for the request.
-- ===========================================================================

create function it.assign_open_tasks_to_executive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_waiting int;
begin
  if new.it_executive_person_id is null
     or new.it_executive_person_id is not distinct from old.it_executive_person_id then
    return null;
  end if;

  perform set_config('it.task_fallback', 'on', true);
  update it.checklist_items
     set assigned_to_person_id = new.it_executive_person_id
   where request_id = new.id
     and assigned_to_person_id is null
     and status in ('Pending', 'In Progress');
  get diagnostics v_count = row_count;
  perform set_config('it.task_fallback', 'off', true);

  -- On a brand-new request the checklist is seeded after this runs; those tasks are counted by
  -- whoever opens it. Here: tell the IT Executive (not when they picked it up themselves).
  select count(*) into v_waiting from it.checklist_items
   where request_id = new.id and assigned_to_person_id = new.it_executive_person_id
     and status in ('Pending', 'In Progress');
  perform it.notify(new.it_executive_person_id, 'lifecycle_owner',
    format('You are the IT Executive on %s %s', lower(new.kind), new.request_number),
    case when v_waiting > 0
         then format('%s · %s task(s) are with you until you assign them.', new.employee_name, v_waiting)
         else format('%s · tasks without an owner come to you.', new.employee_name) end,
    '/it/onboarding/' || new.id, null, new.id);
  return null;
end;
$$;

revoke all on function it.assign_open_tasks_to_executive() from public;

drop trigger if exists trg_lifecycle_assign_open_tasks on it.onboarding_offboarding;
create trigger trg_lifecycle_assign_open_tasks
  after update of it_executive_person_id on it.onboarding_offboarding
  for each row execute function it.assign_open_tasks_to_executive();

-- Same as javaria_it_0003, but silent while tasks fall to the IT Executive automatically.
create or replace function it.notify_checklist_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
begin
  if new.assigned_to_person_id is null
     or (tg_op = 'UPDATE' and new.assigned_to_person_id is not distinct from old.assigned_to_person_id)
     or coalesce(current_setting('it.task_fallback', true), '') = 'on' then
    return null;
  end if;
  select * into v_request from it.onboarding_offboarding where id = new.request_id;
  perform it.notify(new.assigned_to_person_id, 'task_assigned',
    format('Task assigned: %s', new.task_name),
    format('%s %s · %s · due %s', v_request.kind, v_request.request_number,
           v_request.employee_name, coalesce(to_char(new.due_date, 'DD Mon YYYY'), '—')),
    '/it/onboarding/' || v_request.id, null, v_request.id);
  return null;
end;
$$;

-- ===========================================================================
-- 3. Task done → tell the IT Executive.
-- ===========================================================================

create function it.notify_checklist_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
  v_title text;
  v_body text;
  v_link text;
begin
  if new.status not in ('Completed', 'Not Applicable') or new.status is not distinct from old.status then
    return null;
  end if;
  select * into v_request from it.onboarding_offboarding where id = new.request_id;
  v_title := format('Task %s: %s', case when new.status = 'Completed' then 'done' else 'not applicable' end,
                    new.task_name);
  v_body := format('%s %s · %s · by %s', v_request.kind, v_request.request_number, v_request.employee_name,
                   coalesce((select full_name from persons where id = current_person_id()), 'IT'));
  v_link := '/it/onboarding/' || v_request.id;

  -- it.notify never tells people about their own action.
  if v_request.it_executive_person_id is not null then
    perform it.notify(v_request.it_executive_person_id, 'task_done', v_title, v_body, v_link, null, v_request.id);
  else
    perform it.notify_holders('it.onboarding.assign', 'task_done', v_title, v_body, v_link, null, v_request.id,
                              current_person_id());
  end if;
  return null;
end;
$$;

revoke all on function it.notify_checklist_done() from public;

drop trigger if exists trg_notify_checklist_done on it.checklist_items;
create trigger trg_notify_checklist_done
  after update of status on it.checklist_items
  for each row execute function it.notify_checklist_done();

commit;
