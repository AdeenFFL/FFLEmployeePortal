-- Replicated from supabase/it-migrations/javaria/javaria_it_0019_route_waiting_on_new_approver.sql
-- (confirmed live 2026-11-02) — see that file's header for the original author/branch/feature
-- notes, and supabase/it-migrations/README.md "Reconciled into the main sequence" for how this
-- batch was verified. Nothing in this file was re-run; it only gives the already-live state a
-- linear, portal-wide migration history.
--
-- Procurement — adding a department approver sends what was waiting for one (BRD §5.5.4,
-- §5.5.14). Before: a demand/invoice stuck waiting for an approver needed someone to re-open it
-- and press "Send for approval" once one was added. Now: adding a department approver — or
-- flipping their "approves demands" / "approves invoices" switch on — routes that department's
-- waiting Categorized demands / Verified invoices straight to Pending Approval.
--
-- New: it.route_waiting_for_department(), trigger trg_route_waiting_on_new_approver.

create function it.route_waiting_for_department(
  p_department_id uuid,
  p_demands boolean,
  p_invoices boolean,
  p_approver_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_who text := coalesce((select full_name from persons where id = p_approver_id), 'An approver');
  v_dept text := (select name from org_units where id = p_department_id);
begin
  if p_demands and exists (select 1 from it.demand_approvers_for(p_department_id)) then
    for v_id in
      select id from it.demands
      where department_id = p_department_id and status = 'Categorized' and deleted_at is null
      order by created_at
    loop
      if it.route_demand_for_approval(v_id, false) then
        insert into it.demand_updates (demand_id, author_person_id, update_type, body)
        values (v_id, null, 'system',
                format('Sent for approval automatically: %s was added as a %s approver', v_who, v_dept));
      end if;
    end loop;
  end if;

  if p_invoices and exists (select 1 from it.invoice_approvers_for(p_department_id)) then
    for v_id in
      select i.id from it.invoices i
      join it.demands d on d.id = i.demand_id
      where d.department_id = p_department_id and i.status = 'Verified' and i.deleted_at is null
      order by i.created_at
    loop
      perform it.route_invoice_for_approval(v_id);
    end loop;
  end if;
end;
$$;

revoke all on function it.route_waiting_for_department(uuid, boolean, boolean, uuid) from public;

create function it.route_waiting_after_approver_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demands boolean := new.can_approve_demands
    and (tg_op = 'INSERT' or not old.can_approve_demands);
  v_invoices boolean := new.can_approve_invoices
    and (tg_op = 'INSERT' or not old.can_approve_invoices);
begin
  if v_demands or v_invoices then
    perform it.route_waiting_for_department(new.department_id, v_demands, v_invoices, new.person_id);
  end if;
  return null;
end;
$$;

revoke all on function it.route_waiting_after_approver_write() from public;

create trigger trg_route_waiting_on_new_approver
  after insert or update of can_approve_demands, can_approve_invoices on it.department_approvers
  for each row execute function it.route_waiting_after_approver_write();
