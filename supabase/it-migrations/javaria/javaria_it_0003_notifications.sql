-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Phase 5 — Notifications (08-it-service-management-plan.md §5)
-- Depends on:  javaria_it_0001_tickets.sql, javaria_it_0002_onboarding_offboarding.sql
-- Applied to live DB: NO
--
-- Requirements: BRD §5.3.3 (ticket acknowledgement), §5.3.7 (assignment), §5.3.11 (escalation /
-- SLA breach), §5.3.13 (resolution), §5.1.4 / §5.2.5 (new request to IT Executive),
-- §5.1.12–5.1.14 (setup ready / completed), §5.2.13–5.2.15 (final review, completion).
--
-- Design:
--   * it.notifications is the portal inbox (the top-bar bell). Rows are written ONLY by the
--     security-definer triggers below — never by app code — so no screen can forget to notify.
--   * Email goes out from the app (lib/it/notifications.ts, Microsoft Graph), which picks up rows
--     with email_status = 'pending' after each IT action. Without MS_GRAPH_* configured they're
--     marked 'skipped' rather than piling up to be sent weeks later.
--   * The actor never notifies themselves, except the requester's own acknowledgement (§5.3.3).
--   * SLA breaches can't be caught by a trigger (nothing changes when a deadline passes), so
--     it.notify_sla_breaches() is meant to be scheduled — see Part E.
--
-- Scope note: this is IT-only. If other modules need a shared inbox later, the table moves to a
-- core schema; nothing outside IT reads it.

-- ===========================================================================
-- PART A — Table + RLS.
-- ===========================================================================

create table it.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_person_id uuid references public.persons(id) on delete cascade,
  recipient_email text, -- only for someone with no portal account (not used yet; kept for §5.1.12)
  event text not null,
  title text not null,
  body text,
  link text,
  ticket_id uuid references it.tickets(id) on delete cascade,
  request_id uuid references it.onboarding_offboarding(id) on delete cascade,
  read_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_error text,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_has_recipient
    check (recipient_person_id is not null or recipient_email is not null)
);

create index notifications_inbox_idx on it.notifications (recipient_person_id, created_at desc);
create index notifications_unread_idx on it.notifications (recipient_person_id) where read_at is null;
create index notifications_email_pending_idx on it.notifications (created_at) where email_status = 'pending';

alter table it.notifications enable row level security;

create policy "notifications select own" on it.notifications
  for select to authenticated using (recipient_person_id = current_person_id());

create policy "notifications mark own read" on it.notifications
  for update to authenticated
  using (recipient_person_id = current_person_id())
  with check (recipient_person_id = current_person_id());

-- Recipients may only flip read_at; everything else is written by triggers / the mailer
-- (service role). Default privileges from the foundation granted full DML, so narrow it here.
revoke insert, update, delete on it.notifications from authenticated;
grant select on it.notifications to authenticated;
grant update (read_at) on it.notifications to authenticated;

-- The mailer (lib/it/notifications.ts) runs with the secret key = service_role, which bypasses
-- RLS but still needs ordinary privileges; the foundation only granted `authenticated`.
grant usage on schema it to service_role;
grant select, update on it.notifications to service_role;

alter table it.tickets add column sla_breach_notified_at timestamptz;

-- ===========================================================================
-- PART B — Helpers (internal: called by triggers only, no execute grant).
-- ===========================================================================

create function it.notify(
  p_recipient uuid,
  p_event text,
  p_title text,
  p_body text,
  p_link text,
  p_ticket_id uuid default null,
  p_request_id uuid default null,
  p_include_actor boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  if not p_include_actor and p_recipient = current_person_id() then
    return;
  end if;
  -- Only people who can actually sign in get an inbox entry.
  if not exists (
    select 1 from persons p
    join user_accounts ua on ua.person_id = p.id
    where p.id = p_recipient and p.status = 'Active' and ua.status = 'Active'
  ) then
    return;
  end if;

  insert into it.notifications (recipient_person_id, event, title, body, link, ticket_id, request_id)
  values (p_recipient, p_event, p_title, left(p_body, 500), p_link, p_ticket_id, p_request_id);
end;
$$;

-- Everyone holding a permission (e.g. every IT Executive), minus the actor and `p_skip`.
create function it.notify_holders(
  p_permission text,
  p_event text,
  p_title text,
  p_body text,
  p_link text,
  p_ticket_id uuid default null,
  p_request_id uuid default null,
  p_skip uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
begin
  for v_person in
    select distinct ur.person_id
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions perm on perm.id = rp.permission_id
    where perm.key = p_permission
      and ur.person_id is distinct from p_skip
  loop
    perform it.notify(v_person, p_event, p_title, p_body, p_link, p_ticket_id, p_request_id);
  end loop;
end;
$$;

revoke all on function it.notify(uuid, text, text, text, text, uuid, uuid, boolean) from public;
revoke all on function it.notify_holders(text, text, text, text, text, uuid, uuid, uuid) from public;

-- ===========================================================================
-- PART C — Tickets.
-- ===========================================================================

create function it.notify_ticket_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- §5.3.3 acknowledgement to the requester (their own action, so include_actor).
  perform it.notify(new.requester_person_id, 'ticket_created',
    format('Ticket %s received', new.ticket_number),
    format('We''ve logged your request "%s". IT will review and assign it shortly.', new.subject),
    '/it/my-tickets/' || new.id, new.id, null, true);

  -- §5.3.3 / §5.3.4 to IT Executives for review and assignment.
  perform it.notify_holders('it.tickets.assign', 'ticket_new',
    format('New IT ticket %s (%s)', new.ticket_number, new.priority),
    format('%s: %s',
           coalesce((select full_name from persons where id = new.requester_person_id), 'Employee'),
           new.subject),
    '/it/tickets/' || new.id, new.id);
  return null;
end;
$$;

create trigger trg_notify_ticket_insert
  after insert on it.tickets
  for each row execute function it.notify_ticket_insert();

create function it.notify_ticket_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_link text := '/it/tickets/' || new.id;
  v_my_link text := '/it/my-tickets/' || new.id;
begin
  -- §5.3.7 assignment.
  if new.assigned_to_person_id is distinct from old.assigned_to_person_id
     and new.assigned_to_person_id is not null then
    perform it.notify(new.assigned_to_person_id, 'ticket_assigned',
      format('Ticket %s assigned to you', new.ticket_number),
      format('%s · %s priority · due %s', new.subject, new.priority,
             coalesce(to_char(new.resolution_due_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), '—')),
      v_staff_link, new.id);
  end if;

  if new.status is distinct from old.status then
    -- §5.3.13 resolved: ask the requester to confirm.
    if new.status = 'Resolved' then
      perform it.notify(new.requester_person_id, 'ticket_resolved',
        format('Ticket %s resolved — please confirm', new.ticket_number),
        coalesce(new.resolution_notes, new.subject), v_my_link, new.id);
      if new.requested_for_person_id is distinct from new.requester_person_id then
        perform it.notify(new.requested_for_person_id, 'ticket_resolved',
          format('Ticket %s resolved — please confirm', new.ticket_number),
          coalesce(new.resolution_notes, new.subject), v_my_link, new.id);
      end if;
    elsif new.status = 'Closed' then
      perform it.notify(new.requester_person_id, 'ticket_closed',
        format('Ticket %s closed', new.ticket_number), new.subject, v_my_link, new.id);
    elsif old.status = 'Resolved' then
      -- Reopened by the requester: back to whoever owns it.
      if new.assigned_to_person_id is not null then
        perform it.notify(new.assigned_to_person_id, 'ticket_reopened',
          format('Ticket %s reopened', new.ticket_number), new.subject, v_staff_link, new.id);
      else
        perform it.notify_holders('it.tickets.assign', 'ticket_reopened',
          format('Ticket %s reopened', new.ticket_number), new.subject, v_staff_link, new.id);
      end if;
    end if;
  end if;

  -- §5.3.11 escalation.
  if new.is_escalated and not old.is_escalated then
    perform it.notify_holders('it.tickets.assign', 'ticket_escalated',
      format('Ticket %s escalated', new.ticket_number),
      coalesce(new.escalation_reason, new.subject), v_staff_link, new.id,
      null, new.assigned_to_person_id);
    perform it.notify(new.assigned_to_person_id, 'ticket_escalated',
      format('Ticket %s escalated', new.ticket_number),
      coalesce(new.escalation_reason, new.subject), v_staff_link, new.id);
  end if;

  return null;
end;
$$;

create trigger trg_notify_ticket_update
  after update on it.tickets
  for each row execute function it.notify_ticket_update();

-- Public comments only; internal work notes never notify the requester.
create function it.notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
begin
  if new.update_type <> 'comment' or new.is_internal or new.author_person_id is null then
    return null;
  end if;
  select * into v_ticket from it.tickets where id = new.ticket_id;

  if new.author_person_id in (v_ticket.requester_person_id, v_ticket.requested_for_person_id) then
    if v_ticket.assigned_to_person_id is not null then
      perform it.notify(v_ticket.assigned_to_person_id, 'ticket_comment',
        format('New comment on %s', v_ticket.ticket_number), new.body,
        '/it/tickets/' || v_ticket.id, v_ticket.id);
    else
      perform it.notify_holders('it.tickets.assign', 'ticket_comment',
        format('New comment on %s', v_ticket.ticket_number), new.body,
        '/it/tickets/' || v_ticket.id, v_ticket.id);
    end if;
  else
    perform it.notify(v_ticket.requester_person_id, 'ticket_reply',
      format('IT replied on %s', v_ticket.ticket_number), new.body,
      '/it/my-tickets/' || v_ticket.id, v_ticket.id);
    if v_ticket.requested_for_person_id is distinct from v_ticket.requester_person_id then
      perform it.notify(v_ticket.requested_for_person_id, 'ticket_reply',
        format('IT replied on %s', v_ticket.ticket_number), new.body,
        '/it/my-tickets/' || v_ticket.id, v_ticket.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_notify_ticket_comment
  after insert on it.ticket_updates
  for each row execute function it.notify_ticket_comment();

-- ===========================================================================
-- PART D — Onboarding / Offboarding.
-- ===========================================================================

create function it.notify_lifecycle_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- §5.1.4 / §5.2.5 new request to the IT Executives.
  perform it.notify_holders('it.onboarding.assign', 'lifecycle_new',
    format('New %s request %s', lower(new.kind), new.request_number),
    format('%s · due %s · %s', new.employee_name,
           coalesce(to_char(new.due_date, 'DD Mon YYYY'), '—'), new.routing_team),
    '/it/onboarding/' || new.id, null, new.id);
  return null;
end;
$$;

create trigger trg_notify_lifecycle_insert
  after insert on it.onboarding_offboarding
  for each row execute function it.notify_lifecycle_insert();

create function it.notify_lifecycle_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text := '/it/onboarding/' || new.id;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'Awaiting Confirmation' then
    -- §5.1.12 / §5.1.13: the new joiner checks their setup; HR learns IT's part is done.
    perform it.notify(new.person_id, 'onboarding_confirm',
      'Your IT setup is ready — please confirm',
      'Check your email, system access, software and equipment, then confirm on My Onboarding.',
      '/it/my-onboarding', null, new.id);
    perform it.notify(new.requested_by, 'onboarding_ready',
      format('IT setup done for %s (%s)', new.employee_name, new.request_number),
      'Waiting for the employee to confirm.', v_link, null, new.id);
  elsif new.status = 'Pending Final Review' then
    -- §5.2.13 final review.
    perform it.notify_holders('it.onboarding.approve', 'offboarding_review',
      format('Offboarding %s ready for final review', new.request_number),
      format('%s · checklist complete', new.employee_name), v_link, null, new.id,
      new.it_executive_person_id);
    perform it.notify(new.it_executive_person_id, 'offboarding_review',
      format('Offboarding %s ready for sign-off', new.request_number),
      format('%s · checklist complete — sign as IT Executive', new.employee_name),
      v_link, null, new.id);
  elsif new.status = 'Completed' then
    -- §5.1.14 / §5.2.15 completion to HR and the IT Executive.
    perform it.notify(new.requested_by, 'lifecycle_completed',
      format('%s %s completed', new.kind, new.request_number), new.employee_name,
      v_link, null, new.id);
    perform it.notify(new.it_executive_person_id, 'lifecycle_completed',
      format('%s %s completed', new.kind, new.request_number), new.employee_name,
      v_link, null, new.id);
  elsif new.status = 'Cancelled' then
    perform it.notify(new.requested_by, 'lifecycle_cancelled',
      format('%s %s cancelled', new.kind, new.request_number),
      coalesce(new.cancelled_reason, new.employee_name), v_link, null, new.id);
  end if;
  return null;
end;
$$;

create trigger trg_notify_lifecycle_update
  after update on it.onboarding_offboarding
  for each row execute function it.notify_lifecycle_update();

create function it.notify_checklist_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
begin
  if new.assigned_to_person_id is null
     or (tg_op = 'UPDATE' and new.assigned_to_person_id is not distinct from old.assigned_to_person_id) then
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

create trigger trg_notify_checklist_assignment
  after insert or update on it.checklist_items
  for each row execute function it.notify_checklist_assignment();

create function it.notify_lifecycle_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request it.onboarding_offboarding%rowtype;
  v_from_it boolean;
begin
  if new.update_type <> 'comment' or new.is_internal or new.author_person_id is null then
    return null;
  end if;
  select * into v_request from it.onboarding_offboarding where id = new.request_id;
  v_from_it := has_permission('it.onboarding.update')
            or has_permission('it.onboarding.assign')
            or has_permission('it.onboarding.approve');

  if v_from_it then
    perform it.notify(v_request.requested_by, 'lifecycle_comment',
      format('IT commented on %s', v_request.request_number), new.body,
      '/it/onboarding/' || v_request.id, null, v_request.id);
    if v_request.kind = 'Onboarding' then
      perform it.notify(v_request.person_id, 'lifecycle_comment',
        'IT sent you a message about your onboarding', new.body,
        '/it/my-onboarding', null, v_request.id);
    end if;
  elsif v_request.it_executive_person_id is not null then
    perform it.notify(v_request.it_executive_person_id, 'lifecycle_comment',
      format('New comment on %s', v_request.request_number), new.body,
      '/it/onboarding/' || v_request.id, null, v_request.id);
  else
    perform it.notify_holders('it.onboarding.assign', 'lifecycle_comment',
      format('New comment on %s', v_request.request_number), new.body,
      '/it/onboarding/' || v_request.id, null, v_request.id);
  end if;
  return null;
end;
$$;

create trigger trg_notify_lifecycle_comment
  after insert on it.onboarding_updates
  for each row execute function it.notify_lifecycle_comment();

-- ===========================================================================
-- PART E — SLA breach sweep (BRD §5.3.11 "the system will automatically notify the IT
-- Executive"). Notifies once per ticket. Schedule it, e.g. every 15 minutes with pg_cron
-- (Database -> Extensions -> pg_cron, then):
--   select cron.schedule('it-sla-breach-sweep', '*/15 * * * *',
--                        $$select it.notify_sla_breaches()$$);
-- Until scheduled, it can be run by hand from the SQL editor.
-- ===========================================================================

create function it.notify_sla_breaches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
  v_count int := 0;
begin
  for v_ticket in
    select * from it.tickets
    where status in ('Open', 'Assigned', 'In Progress', 'On Hold')
      and resolution_due_at < now()
      and sla_breach_notified_at is null
    for update skip locked
  loop
    perform it.notify_holders('it.tickets.assign', 'ticket_sla_breached',
      format('SLA breached: %s (%s)', v_ticket.ticket_number, v_ticket.priority),
      v_ticket.subject, '/it/tickets/' || v_ticket.id, v_ticket.id, null,
      v_ticket.assigned_to_person_id);
    perform it.notify(v_ticket.assigned_to_person_id, 'ticket_sla_breached',
      format('SLA breached: %s (%s)', v_ticket.ticket_number, v_ticket.priority),
      v_ticket.subject, '/it/tickets/' || v_ticket.id, v_ticket.id);
    update it.tickets set sla_breach_notified_at = now() where id = v_ticket.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function it.notify_sla_breaches() from public;
