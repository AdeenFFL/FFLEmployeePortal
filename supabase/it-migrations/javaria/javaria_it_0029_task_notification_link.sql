-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     My Tasks (2026-11-20). Each onboarding / offboarding / replacement checklist task now
--              has its own page (/it/onboarding/<request>/tasks/<task>) showing only that task and
--              what it needs. The "Task assigned" notification opens that page instead of the whole
--              request, so the person sees just their task.
-- Depends on:  javaria_it_0028_onboarding_task_flow.sql (same function, same rules)
-- Applied to live DB: NO
--
-- Function REPLACED: it.notify_checklist_assignment (only the link changes). Safe to run again.

begin;

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
    '/it/onboarding/' || v_request.id || '/tasks/' || new.id, null, v_request.id);
  return null;
end;
$$;

commit;
