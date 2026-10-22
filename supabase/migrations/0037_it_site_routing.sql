-- Employee Portal — IT module (M2), Service Management track: ticket site isolation and HQ
-- routing (it.settings, it.site_it_staff, handling-site computation, scope/visibility helpers,
-- transfer-to-HQ). Replicated into the main sequence from
-- supabase/it-migrations/javaria/javaria_it_0005_site_routing.sql (Javaria, IT/javaria) —
-- confirmed already live via direct inspection, not re-run here.
--
-- What this does
--   * Each ticket gets a HANDLING SITE: the requester's own site (persons.site_id), or the HQ
--     site when its request type / category / subcategory is marked "handled at HQ" (email,
--     SAP / ERP IDs …) or the requester has no site.
--   * Site IT teams (it.site_it_staff: manager | member) see only their site's tickets.
--     HQ IT Executives (new it.tickets.read_all + it.tickets.assign) see every site.
--     Enforced by RLS, not just the UI.
--   * Site managers assign within their own site's IT staff and can Transfer to HQ; only HQ
--     IT Executives can move a ticket to any site.
--
-- Decisions taken while writing (plan §8 / review 2026-10-16):
--   * Module-local it.site_it_staff, not user_roles.site_id: User Management can't set a site on
--     a role today, and that screen belongs to core. Revisit if core adds scoped roles.
--   * Routing uses persons.site_id, not the ticket form's Location (which the employee picks),
--     because the handling site now decides visibility.
--   * One HQ setting (it.settings.hq_site_id) also feeds onboarding's routing_team_for_site().
--   * Rollout: it.tickets.read_all is granted to every role that already has
--     it.tickets.assign (live check 2026-10-16: only Admin holds any it.tickets.* key), so nobody
--     loses visibility. Plant staff only get site-scoped access once added to it.site_it_staff.
--   * Closed stays final (unchanged); Transfer / move clear the assignee.
--
-- Functions REPLACED here (same signatures): it.tickets_before_update, it.list_it_staff,
-- it.notify_ticket_insert, it.notify_ticket_update, it.notify_ticket_comment,
-- it.notify_sla_breaches, it.routing_team_for_site, it.search_employees.
-- Policies REPLACED: tickets select/update, ticket_updates select, ticket_tasks select/update/delete.

-- ===========================================================================
-- PART A — Settings, site IT staff, HQ-handled flags.
-- ===========================================================================

create table it.settings (
  id boolean primary key default true check (id), -- exactly one row
  hq_site_id uuid references public.org_units(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.persons(id) on delete set null
);

create trigger settings_set_updated_at
  before update on it.settings
  for each row execute function public.set_updated_at();

-- Seed the HQ site from org_units when one is already marked head_office; otherwise it stays
-- empty until an IT admin picks it on /it/settings/sites (live check 2026-10-16: none marked).
insert into it.settings (id, hq_site_id)
select true, (
  select o.id from public.org_units o
  where o.type = 'Site' and o.site_type = 'head_office' and o.is_active
  order by o.name limit 1
);

create table it.site_it_staff (
  site_id uuid not null references public.org_units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  role text not null default 'member' check (role in ('manager', 'member')),
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  primary key (site_id, person_id)
);

create index site_it_staff_person_idx on it.site_it_staff (person_id);

alter table it.ticket_categories
  add column handled_at text not null default 'site' check (handled_at in ('site', 'hq'));
alter table it.request_types
  add column handled_at text not null default 'site' check (handled_at in ('site', 'hq'));

-- Plan §8 #1 defaults: email and SAP / ERP access are handled at HQ. Matched by name against the
-- live request types (Access Request, Email Issue) and the seeded ERP Issue subcategory; the
-- IT BA can change any of these on Ticket Settings.
update it.request_types set handled_at = 'hq' where name in ('Access Request', 'Email Issue');
update it.ticket_categories set handled_at = 'hq' where name = 'ERP Issue';

alter table it.settings enable row level security;
alter table it.site_it_staff enable row level security;

create policy "settings readable by authenticated" on it.settings
  for select to authenticated using (true);
create policy "settings update by ticket settings" on it.settings
  for update to authenticated
  using (has_permission('it.ticket_settings.update'))
  with check (has_permission('it.ticket_settings.update'));

create policy "site_it_staff readable by authenticated" on it.site_it_staff
  for select to authenticated using (true);
create policy "site_it_staff write by ticket settings" on it.site_it_staff
  for all to authenticated
  using (has_permission('it.ticket_settings.update'))
  with check (has_permission('it.ticket_settings.update'));

grant select, update on it.settings to authenticated;
grant select, insert, update, delete on it.site_it_staff to authenticated;

-- ===========================================================================
-- PART B — Scope helpers (security definer, so policies can call them without RLS recursion).
-- ===========================================================================

create function it.hq_site_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select hq_site_id from it.settings where id;
$$;

create function it.is_site_member(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.site_it_staff
    where site_id = p_site_id and person_id = current_person_id()
  );
$$;

create function it.is_site_manager(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.site_it_staff
    where site_id = p_site_id and person_id = current_person_id() and role = 'manager'
  );
$$;

-- HQ IT Executive = sees every site AND may assign.
create function it.is_hq_executive()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.tickets.read_all') and has_permission('it.tickets.assign');
$$;

-- Staff-level visibility of a handling site's tickets (incl. internal notes).
create function it.can_see_site_tickets(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.tickets.read_all')
      or (has_permission('it.tickets.read') and p_site_id is not null and it.is_site_member(p_site_id));
$$;

-- Triage rights (assign, priority, escalate) on a handling site's tickets.
create function it.can_manage_site(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select it.is_hq_executive()
      or (has_permission('it.tickets.read') and p_site_id is not null and it.is_site_manager(p_site_id));
$$;

-- What the current user's ticket scope is — for the screens (banner, filters, panels).
create function it.my_ticket_scope()
returns table (read_all boolean, hq_executive boolean, site_ids uuid[], managed_site_ids uuid[], hq_site_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select
    has_permission('it.tickets.read_all'),
    it.is_hq_executive(),
    coalesce(array(select site_id from it.site_it_staff where person_id = current_person_id()), '{}'),
    coalesce(array(select site_id from it.site_it_staff
                   where person_id = current_person_id() and role = 'manager'), '{}'),
    it.hq_site_id();
$$;

-- ===========================================================================
-- PART C — Handling site on tickets + routing.
-- ===========================================================================

alter table it.tickets
  add column handling_site_id uuid references public.org_units(id);

create index tickets_handling_site_idx on it.tickets (handling_site_id);

create function it.compute_handling_site(
  p_requester uuid,
  p_request_type uuid,
  p_category uuid,
  p_subcategory uuid
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (select 1 from it.request_types where id = p_request_type and handled_at = 'hq')
      or exists (select 1 from it.ticket_categories
                 where id in (p_category, p_subcategory) and handled_at = 'hq')
      then it.hq_site_id()
    else coalesce((select site_id from persons where id = p_requester), it.hq_site_id())
  end;
$$;

-- New tickets: the handling site is always computed, never taken from the client.
create function it.tickets_route_insert()
returns trigger
language plpgsql
as $$
begin
  new.handling_site_id := it.compute_handling_site(
    new.requester_person_id, new.request_type_id, new.category_id, new.subcategory_id);
  return new;
end;
$$;

-- Named to sort after trg_tickets_before_insert (same-timing triggers fire alphabetically).
create trigger trg_tickets_route_insert
  before insert on it.tickets
  for each row execute function it.tickets_route_insert();

-- Backfill existing tickets. old.handling_site_id is null for these, which the update trigger
-- below treats as "first routing" (no assignee clearing, no move notification).
update it.tickets
   set handling_site_id = it.compute_handling_site(
         requester_person_id, request_type_id, category_id, subcategory_id)
 where handling_site_id is null;

-- ===========================================================================
-- PART D — Workflow rules, now site-aware. Replaces javaria_it_0001's version.
--   * assign / re-prioritise / escalate -> it.can_manage_site(handling site)
--   * site managers may only assign their own site's IT staff
--   * move to another site -> HQ IT Executive only (site managers use transfer_ticket_to_hq)
--   * changing request type / category re-routes, unless the same update moves the site
--   * a real move (old site not null) clears the assignee
--   * close -> it.tickets.close; resolve needs notes; Closed is final (unchanged)
-- `it.ticket_system` = 'on' marks trusted updates from security-definer functions.
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

  -- Immutable after creation.
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

  -- Re-route when the classification changes (unless this same update moves the site).
  if (new.request_type_id is distinct from old.request_type_id
      or new.category_id is distinct from old.category_id
      or new.subcategory_id is distinct from old.subcategory_id)
     and new.handling_site_id is not distinct from old.handling_site_id then
    new.handling_site_id := it.compute_handling_site(
      new.requester_person_id, new.request_type_id, new.category_id, new.subcategory_id);
  end if;

  -- A real move to another site: the old site's assignee no longer applies.
  if new.handling_site_id is distinct from old.handling_site_id
     and old.handling_site_id is not null
     and new.assigned_to_person_id is not distinct from old.assigned_to_person_id then
    new.assigned_to_person_id := null;
    if new.status in ('Assigned', 'In Progress', 'On Hold') then
      new.status := 'Open';
    end if;
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
    if old.status = 'Open' and new.first_responded_at is null and new.status <> 'Open' then
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

-- Timeline + notification when a ticket lands at a different site (HQ Executive move, or
-- re-routing after a re-classification). Transfer to HQ logs its own entry with the reason.
create function it.log_ticket_site_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_name text;
begin
  if new.handling_site_id is not distinct from old.handling_site_id
     or old.handling_site_id is null then
    return null;
  end if;

  v_site_name := coalesce((select name from org_units where id = new.handling_site_id), 'HQ / unrouted');

  if coalesce(current_setting('it.ticket_system', true), '') <> 'on' then
    insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
    values (new.id, current_person_id(), 'system', format('Moved to %s', v_site_name));
  end if;

  perform it.notify_ticket_handlers(new.handling_site_id, 'ticket_routed',
    format('Ticket %s routed to %s', new.ticket_number, v_site_name), new.subject,
    '/it/tickets/' || new.id, new.id);
  return null;
end;
$$;

-- ===========================================================================
-- PART E — Row Level Security, now site-scoped (replaces javaria_it_0001's policies).
-- ===========================================================================

drop policy "tickets select own, assigned, or it staff" on it.tickets;
create policy "tickets select own, assigned, or site staff" on it.tickets
  for select to authenticated using (
    requester_person_id = current_person_id()
    or requested_for_person_id = current_person_id()
    or assigned_to_person_id = current_person_id()
    or it.can_see_site_tickets(handling_site_id)
  );

drop policy "tickets update by it staff" on it.tickets;
create policy "tickets update by site managers, hq or assignee" on it.tickets
  for update to authenticated
  using (
    it.can_manage_site(handling_site_id)
    or (has_permission('it.tickets.update') and assigned_to_person_id = current_person_id())
  )
  with check (
    it.can_manage_site(handling_site_id)
    or it.is_hq_executive()
    or has_permission('it.tickets.update')
  );

-- Internal notes: site staff of the ticket's handling site, HQ, or the assignee.
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
        )
    )
  );

drop policy "ticket_tasks select" on it.ticket_tasks;
create policy "ticket_tasks select" on it.ticket_tasks
  for select to authenticated using (
    assigned_to_person_id = current_person_id()
    or exists (
      select 1 from it.tickets t
      where t.id = ticket_id
        and (it.can_see_site_tickets(t.handling_site_id)
             or t.assigned_to_person_id = current_person_id())
    )
  );

drop policy "ticket_tasks update by assignee or executive" on it.ticket_tasks;
create policy "ticket_tasks update by assignee or site manager" on it.ticket_tasks
  for update to authenticated
  using (
    (has_permission('it.tickets.update') and assigned_to_person_id = current_person_id())
    or exists (
      select 1 from it.tickets t
      where t.id = ticket_id and it.can_manage_site(t.handling_site_id)
    )
  )
  with check (has_permission('it.tickets.update') or has_permission('it.tickets.read'));

drop policy "ticket_tasks delete by executive" on it.ticket_tasks;
create policy "ticket_tasks delete by site manager" on it.ticket_tasks
  for delete to authenticated using (
    exists (
      select 1 from it.tickets t
      where t.id = ticket_id and it.can_manage_site(t.handling_site_id)
    )
  );

-- (tickets insert, ticket_updates insert, ticket_tasks insert, attachments and storage
--  policies all test visibility through it.tickets, so they inherit the site scoping.)

-- ===========================================================================
-- PART F — Transfer to HQ (site managers / HQ Executives).
-- ===========================================================================

create function it.transfer_ticket_to_hq(p_ticket_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
  v_hq uuid := it.hq_site_id();
begin
  if v_hq is null then
    raise exception 'The HQ site has not been set yet (IT Settings → Sites & IT staff)';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Please give a reason for transferring to HQ';
  end if;

  select * into v_ticket from it.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;
  if v_ticket.status in ('Resolved', 'Closed') then
    raise exception 'Only open tickets can be transferred';
  end if;
  if v_ticket.handling_site_id = v_hq then
    raise exception 'This ticket is already handled at HQ';
  end if;
  if not it.can_manage_site(v_ticket.handling_site_id) then
    raise exception 'Only this site''s IT manager or an HQ IT Executive can transfer the ticket';
  end if;

  perform set_config('it.ticket_system', 'on', true);
  -- Back to HQ's queue as a fresh, unassigned ticket (it was Open/Assigned/In Progress/On Hold).
  update it.tickets
     set handling_site_id = v_hq,
         assigned_to_person_id = null,
         status = 'Open'
   where id = p_ticket_id;
  perform set_config('it.ticket_system', 'off', true);

  insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
  values (p_ticket_id, current_person_id(), 'system', 'Transferred to HQ: ' || trim(p_reason));
end;
$$;

-- ===========================================================================
-- PART G — Assignee lists, now site-scoped.
-- ===========================================================================

-- Queue "Assigned to" filter: HQ sees all IT staff; others see their own sites' staff.
create or replace function it.list_it_staff()
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
    and (
      has_permission('it.tickets.read_all')
      or exists (
        select 1 from it.site_it_staff mine
        join it.site_it_staff theirs on theirs.site_id = mine.site_id
        where mine.person_id = current_person_id() and theirs.person_id = p.id
      )
    )
  order by p.full_name;
$$;

-- Who may be assigned this ticket (triage + task dropdowns). HQ Executives: any IT staff
-- (it.tickets.update); site managers: their site's IT staff; anyone else: nobody.
create function it.list_ticket_assignees(p_ticket_id uuid)
returns table (person_id uuid, full_name text, designation text, site_role text)
language sql
security definer
set search_path = public
stable
as $$
  with t as (select handling_site_id from it.tickets where id = p_ticket_id)
  select distinct p.id, p.full_name, p.designation,
         (select s.role from it.site_it_staff s, t
          where s.site_id = t.handling_site_id and s.person_id = p.id)
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
  order by p.full_name;
$$;

-- Settings screen: every site's IT staff with names.
create function it.list_site_it_staff()
returns table (site_id uuid, person_id uuid, full_name text, designation text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select s.site_id, s.person_id, p.full_name, p.designation, s.role
  from it.site_it_staff s
  join persons p on p.id = s.person_id
  where has_permission('it.ticket_settings.update') or has_permission('it.tickets.read')
  order by p.full_name;
$$;

-- Employee picker: also open to IT settings admins (for adding site IT staff).
create or replace function it.search_employees(p_search text)
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

-- Onboarding routing reads the same HQ setting (falls back to site_type = 'head_office').
create or replace function it.routing_team_for_site(p_site_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_site_id is null then 'IT HQ Team'
    when p_site_id = it.hq_site_id() then 'IT HQ Team'
    when (select site_type from org_units where id = p_site_id) = 'head_office' then 'IT HQ Team'
    else 'IT Plant Site Team'
  end;
$$;

-- ===========================================================================
-- PART H — Notifications, now site-scoped (replaces javaria_it_0003's versions).
-- ===========================================================================

-- Who handles a site's tickets: its site managers; if it has none, the HQ IT Executives
-- (holders of it.tickets.read_all). p_also_hq adds the HQ Executives anyway (escalations,
-- SLA breaches). Deduplicated; never notifies p_skip.
create function it.notify_ticket_handlers(
  p_site_id uuid,
  p_event text,
  p_title text,
  p_body text,
  p_link text,
  p_ticket_id uuid,
  p_skip uuid default null,
  p_also_hq boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
  v_has_managers boolean := exists (
    select 1 from it.site_it_staff where site_id = p_site_id and role = 'manager');
begin
  for v_person in
    select person_id from it.site_it_staff where site_id = p_site_id and role = 'manager'
    union
    select ur.person_id
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions perm on perm.id = rp.permission_id
    where perm.key = 'it.tickets.read_all' and (p_also_hq or not v_has_managers)
  loop
    if v_person is distinct from p_skip then
      perform it.notify(v_person, p_event, p_title, p_body, p_link, p_ticket_id);
    end if;
  end loop;
end;
$$;

create or replace function it.notify_ticket_insert()
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

  -- §5.3.3 / §5.3.4 to whoever triages the handling site.
  perform it.notify_ticket_handlers(new.handling_site_id, 'ticket_new',
    format('New IT ticket %s (%s)', new.ticket_number, new.priority),
    format('%s: %s',
           coalesce((select full_name from persons where id = new.requester_person_id), 'Employee'),
           new.subject),
    '/it/tickets/' || new.id, new.id);
  return null;
end;
$$;

create or replace function it.notify_ticket_update()
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
      if new.assigned_to_person_id is not null then
        perform it.notify(new.assigned_to_person_id, 'ticket_reopened',
          format('Ticket %s reopened', new.ticket_number), new.subject, v_staff_link, new.id);
      else
        perform it.notify_ticket_handlers(new.handling_site_id, 'ticket_reopened',
          format('Ticket %s reopened', new.ticket_number), new.subject, v_staff_link, new.id);
      end if;
    end if;
  end if;

  -- §5.3.11 escalation: the site's managers AND the HQ IT Executives.
  if new.is_escalated and not old.is_escalated then
    perform it.notify_ticket_handlers(new.handling_site_id, 'ticket_escalated',
      format('Ticket %s escalated', new.ticket_number),
      coalesce(new.escalation_reason, new.subject), v_staff_link, new.id,
      new.assigned_to_person_id, true);
    perform it.notify(new.assigned_to_person_id, 'ticket_escalated',
      format('Ticket %s escalated', new.ticket_number),
      coalesce(new.escalation_reason, new.subject), v_staff_link, new.id);
  end if;

  return null;
end;
$$;

create or replace function it.notify_ticket_comment()
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

create or replace function it.notify_sla_breaches()
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
    perform it.notify_ticket_handlers(v_ticket.handling_site_id, 'ticket_sla_breached',
      format('SLA breached: %s (%s)', v_ticket.ticket_number, v_ticket.priority),
      v_ticket.subject, '/it/tickets/' || v_ticket.id, v_ticket.id,
      v_ticket.assigned_to_person_id, true);
    perform it.notify(v_ticket.assigned_to_person_id, 'ticket_sla_breached',
      format('SLA breached: %s (%s)', v_ticket.ticket_number, v_ticket.priority),
      v_ticket.subject, '/it/tickets/' || v_ticket.id, v_ticket.id);
    update it.tickets set sla_breach_notified_at = now() where id = v_ticket.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Created after notify_ticket_handlers exists (the function body references it).
create trigger trg_log_ticket_site_change
  after update on it.tickets
  for each row execute function it.log_ticket_site_change();

-- ===========================================================================
-- PART I — Grants and permissions.
-- ===========================================================================

revoke all on function it.hq_site_id() from public;
revoke all on function it.is_site_member(uuid) from public;
revoke all on function it.is_site_manager(uuid) from public;
revoke all on function it.is_hq_executive() from public;
revoke all on function it.can_see_site_tickets(uuid) from public;
revoke all on function it.can_manage_site(uuid) from public;
revoke all on function it.my_ticket_scope() from public;
revoke all on function it.compute_handling_site(uuid, uuid, uuid, uuid) from public;
revoke all on function it.transfer_ticket_to_hq(uuid, text) from public;
revoke all on function it.list_ticket_assignees(uuid) from public;
revoke all on function it.list_site_it_staff() from public;
revoke all on function it.notify_ticket_handlers(uuid, text, text, text, text, uuid, uuid, boolean) from public;

-- Policies and triggers run as the calling user, so these must be executable by them.
grant execute on function it.hq_site_id() to authenticated;
grant execute on function it.is_site_member(uuid) to authenticated;
grant execute on function it.is_site_manager(uuid) to authenticated;
grant execute on function it.is_hq_executive() to authenticated;
grant execute on function it.can_see_site_tickets(uuid) to authenticated;
grant execute on function it.can_manage_site(uuid) to authenticated;
grant execute on function it.my_ticket_scope() to authenticated;
grant execute on function it.compute_handling_site(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function it.transfer_ticket_to_hq(uuid, text) to authenticated;
grant execute on function it.list_ticket_assignees(uuid) to authenticated;
grant execute on function it.list_site_it_staff() to authenticated;
-- it.notify_ticket_handlers: internal (called from security-definer triggers only).

insert into permissions (key, module, label, description) values
  ('it.tickets.read_all', 'it', 'View All Sites'' IT Tickets',
   'HQ IT Executive: see every site''s tickets; with Assign, assign anyone and move tickets between sites')
on conflict (key) do nothing;

-- Rollout safety: everyone who can assign today keeps seeing every site.
insert into role_permissions (role_id, permission_id, granted_by)
-- (null::uuid, not bare null: with DISTINCT, Postgres types an untyped null as text.)
select distinct rp.role_id, p_new.id, null::uuid
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id and p_old.key = 'it.tickets.assign'
cross join permissions p_new
where p_new.key = 'it.tickets.read_all'
on conflict do nothing;
