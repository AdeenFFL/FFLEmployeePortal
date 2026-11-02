-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement — adding a department approver sends what was waiting for one
--              (09-it-procurement-plan.md "BRD alignment 2026-10-28" item 2 follow-up; BRD §5.5.4, §5.5.14)
-- Depends on:  javaria_it_0011_demand_approvals.sql, javaria_it_0014_invoices.sql,
--              javaria_it_0017_procurement_brd_alignment.sql
-- Applied to live DB: YES (confirmed live 2026-11-02 by read-only check)
--
-- Before: a demand raised while its department had no approver stayed Categorized ("no demand
-- approver yet"), and after an approver was added someone had to open each demand and press
-- "Send for approval" (same for verified invoices).
-- Now: when a department approver is added — or their "approves demands" / "approves invoices"
-- switch is turned on — that department's waiting items are routed straight away:
--   * Categorized demands → Pending Approval (it.route_demand_for_approval, not forced: a
--     consumable still waits for "Issue from stock" when the consumable path is on);
--   * Verified invoices → Pending Approval (it.route_invoice_for_approval).
-- Nothing happens while the department still has no approver holding the permission (e.g. the
-- person's role lacks Approve Demands) — no repeat "no approver" notes. "Send for approval"
-- stays for that case and for out-of-stock consumables.
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
