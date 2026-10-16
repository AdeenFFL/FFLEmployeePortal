-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Phase 6.4 — Ticket closure audit (08-it-service-management-plan.md §5 Phase 6)
-- Depends on:  javaria_it_0006_owners_and_assignees.sql (it.ticket_assignees,
--              it.ticket_task_assignees); javaria_it_0005 (handling_site_id, read_all)
-- Applied to live DB: NO
--
-- When a ticket is closed, a frozen copy of it goes to it.ticket_closure_audit: the ticket row,
-- its handling site, assignees (primary + helpers), tasks with their assignees, attachment count,
-- timeline count, and whether the SLA was met. The live ticket keeps its full history on the
-- timeline; this is the "as closed" record auditors can rely on even if master data
-- (categories, staff, sites) changes later.
--
-- Closed is final in this module (a closed ticket can't be reopened), so each ticket gets at
-- most one snapshot. Rows are append-only: no update / delete for anyone; only HQ IT
-- Executives (it.tickets.read_all) can read them.
-- Whether to ALSO write public.audit_log is open (plan §8 #6) — not done here.

create table it.ticket_closure_audit (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references it.tickets(id),
  ticket_number text not null,
  handling_site_id uuid references public.org_units(id) on delete set null,
  closed_by uuid references public.persons(id) on delete set null,
  closed_at timestamptz not null default now(),
  sla_met boolean,
  snapshot jsonb not null
);

create unique index ticket_closure_audit_one_per_ticket on it.ticket_closure_audit (ticket_id);
create index ticket_closure_audit_closed_at_idx on it.ticket_closure_audit (closed_at desc);

create function it.snapshot_closed_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sla_met boolean;
begin
  if not (new.status = 'Closed' and old.status is distinct from 'Closed') then
    return null;
  end if;

  v_sla_met := case
    when new.resolution_due_at is null then null
    else coalesce(new.resolved_at, new.closed_at) <= new.resolution_due_at
  end;

  insert into it.ticket_closure_audit
    (ticket_id, ticket_number, handling_site_id, closed_by, closed_at, sla_met, snapshot)
  values (
    new.id,
    new.ticket_number,
    new.handling_site_id,
    current_person_id(),
    coalesce(new.closed_at, now()),
    v_sla_met,
    jsonb_build_object(
      'ticket', to_jsonb(new),
      'handling_site', (select name from org_units where id = new.handling_site_id),
      'request_type', (select name from it.request_types where id = new.request_type_id),
      'category', (select name from it.ticket_categories where id = new.category_id),
      'subcategory', (select name from it.ticket_categories where id = new.subcategory_id),
      'assignees', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'person_id', a.person_id, 'name', p.full_name, 'role', a.role,
                 'assigned_at', a.assigned_at)
               order by a.role, p.full_name)
        from it.ticket_assignees a join persons p on p.id = a.person_id
        where a.ticket_id = new.id), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'task', k.task_type, 'status', k.status, 'completed_at', k.completed_at,
                 'lead', (select full_name from persons where id = k.assigned_to_person_id),
                 'assignees', coalesce((
                   select jsonb_agg(p2.full_name order by p2.full_name)
                   from it.ticket_task_assignees ta join persons p2 on p2.id = ta.person_id
                   where ta.task_id = k.id), '[]'::jsonb))
               order by k.created_at)
        from it.ticket_tasks k where k.ticket_id = new.id), '[]'::jsonb),
      'attachment_count', (select count(*) from it.ticket_attachments where ticket_id = new.id),
      'timeline_count', (select count(*) from it.ticket_updates where ticket_id = new.id),
      'sla_met', v_sla_met,
      'captured_at', now()
    )
  )
  on conflict (ticket_id) do nothing;

  return null;
end;
$$;

create trigger trg_snapshot_closed_ticket
  after update of status on it.tickets
  for each row execute function it.snapshot_closed_ticket();

alter table it.ticket_closure_audit enable row level security;

create policy "ticket_closure_audit readable by hq" on it.ticket_closure_audit
  for select to authenticated using (has_permission('it.tickets.read_all'));

-- Append-only: written only by the trigger above (security definer); nobody updates / deletes.
revoke insert, update, delete on it.ticket_closure_audit from authenticated;
grant select on it.ticket_closure_audit to authenticated;

revoke all on function it.snapshot_closed_ticket() from public;

-- Backfill: tickets already closed before this migration get their snapshot now.
insert into it.ticket_closure_audit
  (ticket_id, ticket_number, handling_site_id, closed_by, closed_at, sla_met, snapshot)
select t.id, t.ticket_number, t.handling_site_id, t.updated_by, coalesce(t.closed_at, t.updated_at),
       case when t.resolution_due_at is null then null
            else coalesce(t.resolved_at, t.closed_at) <= t.resolution_due_at end,
       jsonb_build_object('ticket', to_jsonb(t), 'backfilled', true, 'captured_at', now())
from it.tickets t
where t.status = 'Closed'
on conflict (ticket_id) do nothing;
