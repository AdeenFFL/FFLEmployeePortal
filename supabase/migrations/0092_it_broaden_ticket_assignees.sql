-- Unified Ticket/Task Tracker, Phase 3 (snuggly-swinging-newt.md): broaden who a ticket task can
-- be delegated to. Before this, it.list_ticket_assignees (0037_it_site_routing.sql) only offered
-- the ticket's handling site's it.site_it_staff roster, or an HQ executive holding
-- it.tickets.update -- "anyone ... who has access to ... the it module" (the literal ask) wasn't
-- covered: someone holding module:it but on neither that site's team nor an HQ exec role had no
-- way to be assigned a task even if they were the right person to help.
--
-- Function REPLACED: it.list_ticket_assignees (same signature/shape, one more OR branch).

begin;

create or replace function it.list_ticket_assignees(p_ticket_id uuid)
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
      or exists (
         select 1 from user_roles ur
         join role_permissions rp on rp.role_id = ur.role_id
         join permissions perm on perm.id = rp.permission_id
         where ur.person_id = p.id and perm.key = 'module:it')
    )
  order by p.full_name;
$$;

commit;
