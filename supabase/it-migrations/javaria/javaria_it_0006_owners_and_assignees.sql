-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Phase 6.2 Category owners & auto-assignment + Phase 6.3 Primary / helper
--              assignees (08-it-service-management-plan.md §5 Phase 6)
-- Depends on:  javaria_it_0005_site_routing.sql (handling_site_id, it.site_it_staff, scope
--              helpers, it.notify_ticket_handlers, its versions of the functions replaced here)
-- Applied to live DB: NO
--
-- 6.2 and 6.3 are one file on purpose: auto-assignment writes the ticket's PRIMARY assignee,
-- so the owner routing and the assignee model are designed together instead of rewriting the
-- same functions twice.
--
-- Rules
--   Category owners (it.category_owners): per (category OR subcategory) × site, at most one
--     ★ primary; must be on that site's IT team. Maintained by IT settings admins or the
--     site's IT managers.
--   Auto-assignment: on a new or re-routed, still-unassigned, Open ticket — owners of the
--     SUBCATEGORY at the handling site win; otherwise owners of the CATEGORY. The primary owner
--     becomes the assignee; the other owners get an FYI. No owners → nobody assigned (the
--     site's managers / HQ were already notified of the new ticket). Auto-assignment does not
--     count as IT's first response, and the timeline shows it as System.
--   Assignees (it.ticket_assignees): one primary + any number of helpers. The primary stays in
--     tickets.assigned_to_person_id (SLA, dashboard, reports and notifications keep using it);
--     a trigger mirrors it into this table. Helpers: see the ticket and its internal notes,
--     comment, add notes and tasks; only the primary changes status / resolves. Only the site's
--     IT manager or an HQ Executive adds / removes helpers, and helpers must be on the site's IT
--     team (HQ Executives may pick anyone). Moving the ticket to another site clears helpers.
--   Tasks: several assignees (it.ticket_task_assignees) besides the existing lead
--     (ticket_tasks.assigned_to_person_id).
--
-- REPLACED (same signatures): it.tickets_before_update, it.log_ticket_changes,
-- it.notify_ticket_comment. DROPPED + recreated (return columns change):
-- it.list_ticket_assignees. Policies replaced: tickets select, ticket_updates select,
-- ticket_tasks select / update.

-- ===========================================================================
-- PART A — Category owners.
-- ===========================================================================

create table it.category_owners (
  category_id uuid not null references it.ticket_categories(id) on delete cascade,
  site_id uuid not null references public.org_units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  primary key (category_id, site_id, person_id)
);

create unique index category_owners_one_primary
  on it.category_owners (category_id, site_id) where is_primary;
create index category_owners_site_idx on it.category_owners (site_id);

-- An owner must be on that site's IT team. Security definer so it works for site managers.
create function it.check_category_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from it.site_it_staff where site_id = new.site_id and person_id = new.person_id
  ) then
    raise exception 'Category owners must be on that site''s IT team (Sites & IT Staff)';
  end if;
  new.created_by := coalesce(new.created_by, current_person_id());
  return new;
end;
$$;

create trigger trg_check_category_owner
  before insert or update on it.category_owners
  for each row execute function it.check_category_owner();

-- Leaving a site's IT team drops that person's category ownerships at the site.
create function it.drop_owner_on_staff_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from it.category_owners where site_id = old.site_id and person_id = old.person_id;
  return null;
end;
$$;

create trigger trg_drop_owner_on_staff_removal
  after delete on it.site_it_staff
  for each row execute function it.drop_owner_on_staff_removal();

alter table it.category_owners enable row level security;

create policy "category_owners readable by authenticated" on it.category_owners
  for select to authenticated using (true);

create policy "category_owners write by settings admin or site manager" on it.category_owners
  for all to authenticated
  using (
    has_permission('it.ticket_settings.update')
    or (has_permission('it.tickets.read') and it.is_site_manager(site_id))
  )
  with check (
    has_permission('it.ticket_settings.update')
    or (has_permission('it.tickets.read') and it.is_site_manager(site_id))
  );

grant select, insert, update, delete on it.category_owners to authenticated;

-- Owners list with names, for the settings grid and the workspace ("Routed to …").
create function it.list_category_owners()
returns table (category_id uuid, site_id uuid, person_id uuid, full_name text, is_primary boolean)
language sql
security definer
set search_path = public
stable
as $$
  select o.category_id, o.site_id, o.person_id, p.full_name, o.is_primary
  from it.category_owners o
  join persons p on p.id = o.person_id
  where has_permission('it.ticket_settings.update') or has_permission('it.tickets.read')
  order by o.is_primary desc, p.full_name;
$$;

-- ===========================================================================
-- PART B — Assignees (primary + helpers) and task assignees.
-- ===========================================================================

create table it.ticket_assignees (
  ticket_id uuid not null references it.tickets(id) on delete cascade,
  person_id uuid not null references public.persons(id),
  role text not null default 'helper' check (role in ('primary', 'helper')),
  assigned_by uuid references public.persons(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (ticket_id, person_id)
);

create unique index ticket_assignees_one_primary
  on it.ticket_assignees (ticket_id) where role = 'primary';
create index ticket_assignees_person_idx on it.ticket_assignees (person_id);

create table it.ticket_task_assignees (
  task_id uuid not null references it.ticket_tasks(id) on delete cascade,
  person_id uuid not null references public.persons(id),
  assigned_at timestamptz not null default now(),
  primary key (task_id, person_id)
);

create index ticket_task_assignees_person_idx on it.ticket_task_assignees (person_id);

-- Security-definer membership tests, so policies can use them without RLS recursion.
create function it.is_ticket_assignee(p_ticket_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.ticket_assignees
    where ticket_id = p_ticket_id and person_id = current_person_id()
  );
$$;

create function it.is_task_assignee(p_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.ticket_task_assignees
    where task_id = p_task_id and person_id = current_person_id()
  );
$$;

-- Mirror tickets.assigned_to_person_id (the primary) into it.ticket_assignees, and clear
-- helpers when the ticket moves to another site.
create function it.sync_ticket_assignees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.handling_site_id is distinct from old.handling_site_id
     and old.handling_site_id is not null then
    delete from it.ticket_assignees where ticket_id = new.id and role = 'helper';
  end if;

  if tg_op = 'INSERT' or new.assigned_to_person_id is distinct from old.assigned_to_person_id then
    delete from it.ticket_assignees where ticket_id = new.id and role = 'primary';
    if new.assigned_to_person_id is not null then
      insert into it.ticket_assignees (ticket_id, person_id, role, assigned_by)
      values (new.id, new.assigned_to_person_id, 'primary', current_person_id())
      on conflict (ticket_id, person_id)
      do update set role = 'primary', assigned_by = excluded.assigned_by, assigned_at = now();
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_sync_ticket_assignees
  after insert or update of assigned_to_person_id, handling_site_id on it.tickets
  for each row execute function it.sync_ticket_assignees();

-- Existing assignments become primary rows.
insert into it.ticket_assignees (ticket_id, person_id, role)
select id, assigned_to_person_id, 'primary'
from it.tickets
where assigned_to_person_id is not null
on conflict do nothing;

-- Helper rules (user-written rows are always helpers; primaries come only from the sync).
create function it.check_ticket_helper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
begin
  select * into v_ticket from it.tickets where id = new.ticket_id;
  if v_ticket.status = 'Closed' then
    raise exception 'Closed tickets are read-only';
  end if;
  if new.role = 'helper' then
    if new.person_id = v_ticket.assigned_to_person_id then
      raise exception 'That person is already the primary assignee';
    end if;
    if not it.is_hq_executive() and not exists (
      select 1 from it.site_it_staff
      where site_id = v_ticket.handling_site_id and person_id = new.person_id
    ) then
      raise exception 'Helpers must be on this ticket''s site IT team';
    end if;
  end if;
  new.assigned_by := coalesce(new.assigned_by, current_person_id());
  return new;
end;
$$;

create trigger trg_check_ticket_helper
  before insert on it.ticket_assignees
  for each row execute function it.check_ticket_helper();

-- Timeline + notification for helpers being added / removed.
create function it.log_ticket_helpers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row it.ticket_assignees%rowtype;
  v_number text;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if v_row.role <> 'helper' then
    return null;
  end if;
  select ticket_number into v_number from it.tickets where id = v_row.ticket_id;

  insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
  values (v_row.ticket_id, current_person_id(), 'assignment',
          format(case when tg_op = 'DELETE' then 'Helper removed: %s' else 'Helper added: %s' end,
                 (select full_name from persons where id = v_row.person_id)));

  if tg_op = 'INSERT' then
    perform it.notify(v_row.person_id, 'ticket_helper_added',
      format('You were added as a helper on %s', v_number), null,
      '/it/tickets/' || v_row.ticket_id, v_row.ticket_id);
  end if;
  return null;
end;
$$;

create trigger trg_log_ticket_helpers
  after insert or delete on it.ticket_assignees
  for each row execute function it.log_ticket_helpers();

alter table it.ticket_assignees enable row level security;
alter table it.ticket_task_assignees enable row level security;

-- Visible to anyone who can see the ticket (subquery runs under it.tickets' RLS).
create policy "ticket_assignees select" on it.ticket_assignees
  for select to authenticated using (
    exists (select 1 from it.tickets t where t.id = ticket_assignees.ticket_id)
  );

create policy "ticket_assignees helpers managed by site manager or hq" on it.ticket_assignees
  for insert to authenticated with check (
    role = 'helper'
    and exists (
      select 1 from it.tickets t
      where t.id = ticket_assignees.ticket_id and it.can_manage_site(t.handling_site_id)
    )
  );

create policy "ticket_assignees helpers removed by site manager or hq" on it.ticket_assignees
  for delete to authenticated using (
    role = 'helper'
    and exists (
      select 1 from it.tickets t
      where t.id = ticket_assignees.ticket_id and it.can_manage_site(t.handling_site_id)
    )
  );

create policy "ticket_task_assignees select" on it.ticket_task_assignees
  for select to authenticated using (
    exists (select 1 from it.ticket_tasks k where k.id = ticket_task_assignees.task_id)
  );

create policy "ticket_task_assignees write by it staff" on it.ticket_task_assignees
  for all to authenticated
  using (
    (has_permission('it.tickets.update') or has_permission('it.tickets.read'))
    and exists (
      select 1 from it.ticket_tasks k
      join it.tickets t on t.id = k.ticket_id
      where k.id = ticket_task_assignees.task_id and t.status <> 'Closed'
    )
  )
  with check (
    (has_permission('it.tickets.update') or has_permission('it.tickets.read'))
    and exists (
      select 1 from it.ticket_tasks k
      join it.tickets t on t.id = k.ticket_id
      where k.id = ticket_task_assignees.task_id and t.status <> 'Closed'
    )
  );

grant select, insert, delete on it.ticket_assignees to authenticated;
grant select, insert, delete on it.ticket_task_assignees to authenticated;

-- ===========================================================================
-- PART C — Visibility for helpers (replaces javaria_it_0005's policies).
-- ===========================================================================

drop policy "tickets select own, assigned, or site staff" on it.tickets;
create policy "tickets select own, assignees, or site staff" on it.tickets
  for select to authenticated using (
    requester_person_id = current_person_id()
    or requested_for_person_id = current_person_id()
    or assigned_to_person_id = current_person_id()
    or it.is_ticket_assignee(id)
    or it.can_see_site_tickets(handling_site_id)
  );

drop policy "ticket_updates select" on it.ticket_updates;
create policy "ticket_updates select" on it.ticket_updates
  for select to authenticated using (
    exists (
      select 1 from it.tickets t
      where t.id = ticket_updates.ticket_id
        and (
          not ticket_updates.is_internal
          or it.can_see_site_tickets(t.handling_site_id)
          or t.assigned_to_person_id = current_person_id()
          or it.is_ticket_assignee(t.id)
        )
    )
  );

drop policy "ticket_tasks select" on it.ticket_tasks;
create policy "ticket_tasks select" on it.ticket_tasks
  for select to authenticated using (
    assigned_to_person_id = current_person_id()
    or it.is_task_assignee(id)
    or exists (
      select 1 from it.tickets t
      where t.id = ticket_tasks.ticket_id
        and (it.can_see_site_tickets(t.handling_site_id)
             or t.assigned_to_person_id = current_person_id()
             or it.is_ticket_assignee(t.id))
    )
  );

drop policy "ticket_tasks update by assignee or site manager" on it.ticket_tasks;
create policy "ticket_tasks update by assignees or site manager" on it.ticket_tasks
  for update to authenticated
  using (
    (has_permission('it.tickets.update')
     and (assigned_to_person_id = current_person_id() or it.is_task_assignee(id)))
    or exists (
      select 1 from it.tickets t
      where t.id = ticket_tasks.ticket_id and it.can_manage_site(t.handling_site_id)
    )
  )
  with check (has_permission('it.tickets.update') or has_permission('it.tickets.read'));

-- ===========================================================================
-- PART D — Workflow trigger (replaces javaria_it_0005's version). Only change: a trusted
-- system update (auto-assignment, transfer) never stamps first_responded_at, so the "first
-- response" KPI measures a person, not the router.
-- ===========================================================================

create or replace function it.tickets_before_update()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := public.current_person_id();
  v_system boolean := coalesce(current_setting('it.ticket_system', true), '') = 'on';
  v_sla it.sla_policies%rowtype;
begin
  if v_actor is not null and not v_system and old.status = 'Closed' then
    raise exception 'Closed tickets are read-only';
  end if;

  new.id := old.id;
  new.ticket_number := old.ticket_number;
  new.requester_person_id := old.requester_person_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.response_due_at := old.response_due_at;
  new.resolution_due_at := old.resolution_due_at;

  if v_actor is not null and not v_system then
    if (new.assigned_to_person_id is distinct from old.assigned_to_person_id
        or new.priority is distinct from old.priority
        or new.is_escalated is distinct from old.is_escalated)
       and not it.can_manage_site(old.handling_site_id) then
      raise exception 'Only the site IT manager or an HQ IT Executive can assign, re-prioritise, or escalate this ticket';
    end if;

    if new.assigned_to_person_id is distinct from old.assigned_to_person_id
       and new.assigned_to_person_id is not null
       and not it.is_hq_executive()
       and not exists (
         select 1 from it.site_it_staff
         where site_id = old.handling_site_id and person_id = new.assigned_to_person_id
       ) then
      raise exception 'You can only assign IT staff of this ticket''s site';
    end if;

    if new.handling_site_id is distinct from old.handling_site_id
       and old.handling_site_id is not null
       and not it.is_hq_executive() then
      raise exception 'Only HQ IT Executives can move a ticket to another site (use Transfer to HQ)';
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

  if (new.request_type_id is distinct from old.request_type_id
      or new.category_id is distinct from old.category_id
      or new.subcategory_id is distinct from old.subcategory_id)
     and new.handling_site_id is not distinct from old.handling_site_id then
    new.handling_site_id := it.compute_handling_site(
      new.requester_person_id, new.request_type_id, new.category_id, new.subcategory_id);
  end if;

  if new.handling_site_id is distinct from old.handling_site_id
     and old.handling_site_id is not null
     and new.assigned_to_person_id is not distinct from old.assigned_to_person_id then
    new.assigned_to_person_id := null;
    if new.status in ('Assigned', 'In Progress', 'On Hold') then
      new.status := 'Open';
    end if;
  end if;

  if new.priority is distinct from old.priority then
    select * into v_sla from it.sla_policies where priority = new.priority;
    if found then
      new.response_due_at := old.created_at + v_sla.response_hours * interval '1 hour';
      new.resolution_due_at := old.created_at + v_sla.resolution_hours * interval '1 hour';
    end if;
  end if;

  if new.assigned_to_person_id is distinct from old.assigned_to_person_id
     and new.status = old.status then
    if new.assigned_to_person_id is not null and old.status = 'Open' then
      new.status := 'Assigned';
    elsif new.assigned_to_person_id is null and old.status = 'Assigned' then
      new.status := 'Open';
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'Open' and new.first_responded_at is null and new.status <> 'Open'
       and not v_system then
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

  new.updated_by := case when v_system then new.updated_by else coalesce(v_actor, new.updated_by) end;
  return new;
end;
$$;

-- Timeline: system-driven changes (auto-assignment, transfer) are authored by "System", not by
-- whoever's action happened to trigger them (e.g. the requester raising the ticket).
create or replace function it.log_ticket_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := case
    when coalesce(current_setting('it.ticket_system', true), '') = 'on' then null
    else current_person_id()
  end;
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
              when v_actor is null then format('Auto-assigned to %s (category owner)',
                          (select full_name from persons where id = new.assigned_to_person_id))
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

-- ===========================================================================
-- PART E — Auto-assignment.
-- ===========================================================================

create function it.auto_assign_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
  v_scope uuid;
  v_primary uuid;
  v_owner uuid;
begin
  select * into v_ticket from it.tickets where id = p_ticket_id;
  if not found
     or v_ticket.assigned_to_person_id is not null
     or v_ticket.status <> 'Open'
     or v_ticket.handling_site_id is null then
    return;
  end if;

  -- Subcategory owners at the handling site win; otherwise the category's.
  if v_ticket.subcategory_id is not null and exists (
       select 1 from it.category_owners
       where category_id = v_ticket.subcategory_id and site_id = v_ticket.handling_site_id) then
    v_scope := v_ticket.subcategory_id;
  elsif v_ticket.category_id is not null and exists (
       select 1 from it.category_owners
       where category_id = v_ticket.category_id and site_id = v_ticket.handling_site_id) then
    v_scope := v_ticket.category_id;
  else
    return;
  end if;

  select o.person_id into v_primary
  from it.category_owners o
  join persons p on p.id = o.person_id and p.status = 'Active'
  where o.category_id = v_scope and o.site_id = v_ticket.handling_site_id and o.is_primary;

  if v_primary is not null then
    perform set_config('it.ticket_system', 'on', true);
    update it.tickets set assigned_to_person_id = v_primary where id = p_ticket_id;
    perform set_config('it.ticket_system', 'off', true);
  end if;

  -- FYI to the other owners (all owners if there's no primary).
  for v_owner in
    select person_id from it.category_owners
    where category_id = v_scope and site_id = v_ticket.handling_site_id
      and person_id is distinct from v_primary
  loop
    perform it.notify(v_owner, 'ticket_owner_fyi',
      format('New %s ticket %s', coalesce(
        (select name from it.ticket_categories where id = v_scope), 'IT'), v_ticket.ticket_number),
      v_ticket.subject, '/it/tickets/' || v_ticket.id, v_ticket.id);
  end loop;
end;
$$;

create function it.auto_assign_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform it.auto_assign_ticket(new.id);
  return null;
end;
$$;

-- Sorts after trg_notify_ticket_insert, so the site is told about the ticket before routing.
create trigger trg_tickets_auto_assign_insert
  after insert on it.tickets
  for each row execute function it.auto_assign_on_insert();

create function it.auto_assign_on_reroute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to_person_id is null
     and (new.handling_site_id is distinct from old.handling_site_id
          or new.category_id is distinct from old.category_id
          or new.subcategory_id is distinct from old.subcategory_id) then
    perform it.auto_assign_ticket(new.id);
  end if;
  return null;
end;
$$;

create trigger trg_tickets_auto_assign_reroute
  after update of handling_site_id, category_id, subcategory_id on it.tickets
  for each row execute function it.auto_assign_on_reroute();

-- ===========================================================================
-- PART F — Assignee list (drop + recreate: adds owner flag, owners listed first) and comment
-- notifications to helpers (replaces javaria_it_0005's notify_ticket_comment).
-- ===========================================================================

drop function it.list_ticket_assignees(uuid);

create function it.list_ticket_assignees(p_ticket_id uuid)
returns table (
  person_id uuid,
  full_name text,
  designation text,
  site_role text,
  is_category_owner boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with t as (
    select handling_site_id, category_id, subcategory_id from it.tickets where id = p_ticket_id
  )
  select distinct p.id, p.full_name, p.designation,
         (select s.role from it.site_it_staff s, t
          where s.site_id = t.handling_site_id and s.person_id = p.id),
         exists (select 1 from it.category_owners o, t
                 where o.site_id = t.handling_site_id and o.person_id = p.id
                   and o.category_id in (t.category_id, t.subcategory_id))
  from persons p
  where p.status = 'Active'
    and (
      (it.is_hq_executive() and exists (
         select 1 from user_roles ur
         join role_permissions rp on rp.role_id = ur.role_id
         join permissions perm on perm.id = rp.permission_id
         where ur.person_id = p.id and perm.key = 'it.tickets.update'))
      or exists (
         select 1 from it.site_it_staff s, t
         where s.site_id = t.handling_site_id and s.person_id = p.id
           and it.can_manage_site(t.handling_site_id))
    )
  order by 5 desc, 2;
$$;

create or replace function it.notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
  v_person uuid;
begin
  if new.update_type <> 'comment' or new.is_internal or new.author_person_id is null then
    return null;
  end if;
  select * into v_ticket from it.tickets where id = new.ticket_id;

  if new.author_person_id in (v_ticket.requester_person_id, v_ticket.requested_for_person_id) then
    if v_ticket.assigned_to_person_id is not null then
      -- Primary + helpers.
      for v_person in
        select person_id from it.ticket_assignees where ticket_id = v_ticket.id
      loop
        perform it.notify(v_person, 'ticket_comment',
          format('New comment on %s', v_ticket.ticket_number), new.body,
          '/it/tickets/' || v_ticket.id, v_ticket.id);
      end loop;
    else
      perform it.notify_ticket_handlers(v_ticket.handling_site_id, 'ticket_comment',
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

-- ===========================================================================
-- PART G — Grants.
-- ===========================================================================

revoke all on function it.check_category_owner() from public;
revoke all on function it.drop_owner_on_staff_removal() from public;
revoke all on function it.list_category_owners() from public;
revoke all on function it.is_ticket_assignee(uuid) from public;
revoke all on function it.is_task_assignee(uuid) from public;
revoke all on function it.sync_ticket_assignees() from public;
revoke all on function it.check_ticket_helper() from public;
revoke all on function it.log_ticket_helpers() from public;
revoke all on function it.auto_assign_ticket(uuid) from public;
revoke all on function it.auto_assign_on_insert() from public;
revoke all on function it.auto_assign_on_reroute() from public;
revoke all on function it.list_ticket_assignees(uuid) from public;

grant execute on function it.list_category_owners() to authenticated;
grant execute on function it.is_ticket_assignee(uuid) to authenticated;
grant execute on function it.is_task_assignee(uuid) to authenticated;
grant execute on function it.list_ticket_assignees(uuid) to authenticated;
-- it.auto_assign_ticket and the trigger functions: internal, no grant.
