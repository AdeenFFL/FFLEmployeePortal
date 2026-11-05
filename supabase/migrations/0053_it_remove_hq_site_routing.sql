-- Employee Portal — IT module: removes the configurable "HQ site" routing feature
-- (it.settings.hq_site_id, ticket_categories/request_types.handled_at, Transfer to HQ) at the
-- user's explicit request. Every ticket now always routes to the requester's own site —
-- no override, no "no site -> HQ" fallback (a requester with no site simply gets an unrouted
-- ticket, same as today's existing "HQ / unrouted" edge case, now just more common since there's
-- no HQ site left to catch it).
--
-- NOT removed (a separate concept, explicitly kept): it.tickets.read_all / it.is_hq_executive() —
-- the permission tier that lets someone see/manage every site's tickets regardless of
-- it.site_it_staff membership. That has nothing to do with a configured "HQ site".
--
-- Onboarding's routing_team label ("IT HQ Team" vs "IT Plant Site Team") is NOT removed either —
-- it reverts to its original, pre-0037 definition based on org_units.site_type = 'head_office'
-- (a real org attribute, unrelated to it.settings.hq_site_id).

begin;

-- Depends on it.hq_site_id() — drop before that function goes away.
drop function if exists it.transfer_ticket_to_hq(uuid, text);

-- Tickets always route to the requester's own site now; no HQ override, no no-site fallback.
create or replace function it.compute_handling_site(
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
  select site_id from persons where id = p_requester;
$$;

-- Reverts to the pre-0037 definition (javaria_it_0001) — org_units.site_type alone, no
-- it.settings dependency.
create or replace function it.routing_team_for_site(p_site_id uuid)
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

-- Column list changes (drops hq_site_id) — create or replace can't do that, drop first.
drop function it.my_ticket_scope();
create function it.my_ticket_scope()
returns table (read_all boolean, hq_executive boolean, site_ids uuid[], managed_site_ids uuid[])
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
                   where person_id = current_person_id() and role = 'manager'), '{}');
$$;
revoke all on function it.my_ticket_scope() from public;
grant execute on function it.my_ticket_scope() to authenticated;

-- Same body as 0038_it_owners_and_assignees.sql's version — only change: the "move to another
-- site" error no longer points at a removed Transfer to HQ feature.
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
      raise exception 'Only HQ IT Executives can move a ticket to another site';
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

alter table it.ticket_categories drop column handled_at;
alter table it.request_types drop column handled_at;

drop function it.hq_site_id();
drop table it.settings;

commit;
