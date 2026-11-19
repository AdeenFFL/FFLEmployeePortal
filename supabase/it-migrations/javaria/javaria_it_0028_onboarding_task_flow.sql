-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Onboarding / offboarding task flow (2026-11-19).
--              1. No task left unassigned: a checklist task whose type has no owner for the site
--                 (IT Settings → Onboarding Tasks) goes to the request's IT Executive. When a
--                 request gets its IT Executive later (Pick up / Take over), its unassigned open
--                 tasks go to them. They can hand each one on with Assign.
--              2. Task done → the IT Executive is told (or, with none yet, everyone who can assign
--                 onboarding work). Assignment already notifies the assignee (javaria_it_0003).
-- Depends on:  0048_it_task_type_owners.sql, 0052_it_onboarding_site_scoping.sql,
--              javaria_it_0003_notifications.sql
-- Applied to live DB: NO
--
-- Functions REPLACED: it.auto_assign_checklist_item. New: it.assign_open_tasks_to_executive,
-- it.notify_checklist_done (+ triggers).

begin;

-- ===========================================================================
-- 1. Owner for the site's task type, else the request's IT Executive.
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

  v_owner := coalesce(v_owner, v_executive);
  if v_owner is not null then
    update it.checklist_items set assigned_to_person_id = v_owner where id = p_item_id;
  end if;
end;
$$;

-- The request got an IT Executive: their open, unassigned tasks go to them.
create function it.assign_open_tasks_to_executive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.it_executive_person_id is null
     or new.it_executive_person_id is not distinct from old.it_executive_person_id then
    return null;
  end if;
  update it.checklist_items
     set assigned_to_person_id = new.it_executive_person_id
   where request_id = new.id
     and assigned_to_person_id is null
     and status in ('Pending', 'In Progress');
  return null;
end;
$$;

revoke all on function it.assign_open_tasks_to_executive() from public;

drop trigger if exists trg_lifecycle_assign_open_tasks on it.onboarding_offboarding;
create trigger trg_lifecycle_assign_open_tasks
  after update of it_executive_person_id on it.onboarding_offboarding
  for each row execute function it.assign_open_tasks_to_executive();

-- ===========================================================================
-- 2. Task done → tell the IT Executive.
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
  v_title := format('Task %s: %s', lower(new.status), new.task_name);
  v_body := format('%s %s · %s · by %s', v_request.kind, v_request.request_number, v_request.employee_name,
                   coalesce((select full_name from persons where id = current_person_id()), 'IT'));
  v_link := '/it/onboarding/' || v_request.id;

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
