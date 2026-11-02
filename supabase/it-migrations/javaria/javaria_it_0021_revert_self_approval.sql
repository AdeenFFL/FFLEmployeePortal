-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement — reverse javaria_it_0020 (testing-mode self-approval dropped)
-- Depends on:  javaria_it_0020_self_approval_testing_mode.sql
-- Applied to live DB: NO
--
-- Decision 2026-11-02: no self-approval, not even as a testing switch. Back to the BRD rule:
-- nobody approves a demand they raised or an invoice they logged.
--   * it.decide_demand, it.decide_invoice → the javaria_it_0011 / javaria_it_0014 versions;
--   * it.route_demand_for_approval → the javaria_it_0017 version, except the "no approver"
--     notification text says waiting demands are sent automatically once an approver is added
--     (javaria_it_0019);
--   * it.self_approval_allowed() and procurement_settings.allow_self_approval dropped.

create or replace function it.decide_demand(
  p_demand_id uuid,
  p_decision text,
  p_approved_quantity int,
  p_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_qty int;
  v_comments text := nullif(trim(coalesce(p_comments, '')), '');
  v_body text;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.is_demand_approver(v_demand.department_id) then
    raise exception 'You are not an approver for this demand''s department';
  end if;
  if v_demand.requested_by_person_id = v_actor then
    raise exception 'You can''t approve a demand you raised yourself';
  end if;
  if v_demand.status <> 'Pending Approval' then
    raise exception 'This demand is not awaiting approval (it is %)', v_demand.status;
  end if;

  if p_decision = 'Approved' then
    v_qty := v_demand.quantity;
  elsif p_decision = 'Partially Approved' then
    if p_approved_quantity is null or p_approved_quantity < 1 or p_approved_quantity >= v_demand.quantity then
      raise exception 'A partial approval must be between 1 and % (less than requested)', v_demand.quantity - 1;
    end if;
    if v_comments is null then
      raise exception 'Please explain the partial approval';
    end if;
    v_qty := p_approved_quantity;
  elsif p_decision = 'Rejected' then
    if v_comments is null then
      raise exception 'Please give a reason for rejecting';
    end if;
    v_qty := 0;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  insert into it.demand_approvals (demand_id, approver_person_id, decision, approved_quantity, comments)
  values (p_demand_id, v_actor, p_decision, v_qty, v_comments);

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set status = p_decision, approved_quantity = v_qty, updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  -- The status change itself is logged and sent to the requester by the demand triggers; the
  -- timeline gets the decision detail here.
  v_body := case p_decision
    when 'Approved' then format('Approved (%s)', v_qty)
    when 'Partially Approved' then format('Partially approved: %s of %s', v_qty, v_demand.quantity)
    else 'Rejected'
  end || coalesce(' — ' || v_comments, '');
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system', v_body);

  -- §5.5.6: site procurement acts next (assign vendor) or is told of reject / partial.
  perform it.notify_demand_processors(v_demand.site_id, 'demand_decided',
    format('Demand %s %s', v_demand.demand_number, lower(p_decision)), v_body, v_demand.id);
end;
$$;

create or replace function it.decide_invoice(p_invoice_id uuid, p_decision text, p_comments text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
  v_comments text := nullif(trim(coalesce(p_comments, '')), '');
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  select * into v_demand from it.demands where id = v_inv.demand_id;
  if v_actor is null or not it.is_invoice_approver(v_demand.department_id) then
    raise exception 'You are not an invoice approver for this department';
  end if;
  if v_actor = v_inv.created_by then
    raise exception 'You logged this invoice, so another approver has to decide it';
  end if;
  if v_inv.status <> 'Pending Approval' then
    raise exception 'This invoice is not awaiting approval (it is %)', v_inv.status;
  end if;

  if p_decision = 'Approved' then
    update it.invoices
       set status = 'Approved', approved_by = v_actor, approved_at = now(),
           approval_comments = v_comments, updated_by = v_actor
     where id = p_invoice_id
    returning * into v_inv;
    perform it.invoice_event(v_inv, 'approved' || coalesce(' — ' || v_comments, ''), true,
      format('Invoice %s approved — send it to Finance', v_inv.invoice_number));
  elsif p_decision = 'Revise' then
    if v_comments is null then
      raise exception 'Please say what needs to be revised';
    end if;
    update it.invoices
       set status = 'Revise', revision_reason = v_comments, approval_comments = v_comments, updated_by = v_actor
     where id = p_invoice_id
    returning * into v_inv;
    perform it.invoice_event(v_inv, 'sent back for revision — ' || v_comments, true,
      format('Invoice %s needs revision', v_inv.invoice_number));
  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end;
$$;

create or replace function it.route_demand_for_approval(p_demand_id uuid, p_force boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
  v_consumable_path boolean;
  v_product text;
  v_person uuid;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null;
  if not found or v_demand.status <> 'Categorized' then
    return false;
  end if;

  select consumable_path_enabled into v_consumable_path from it.procurement_settings where id;
  if not p_force and v_demand.demand_category = 'Consumable' and coalesce(v_consumable_path, false) then
    return false; -- issued from stock by procurement (BRD §5.5.3)
  end if;

  if not exists (select 1 from it.demand_approvers_for(v_demand.department_id)) then
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (p_demand_id, null, 'system',
            format('Waiting to be sent for approval: the %s department has no demand approver yet',
                   (select name from org_units where id = v_demand.department_id)));
    perform it.notify_demand_processors(v_demand.site_id, 'demand_no_approver',
      format('Demand %s can''t be routed for approval', v_demand.demand_number),
      format('The %s department has no demand approver. Add one under Department Approvers — waiting demands are then sent for approval automatically.',
             (select name from org_units where id = v_demand.department_id)),
      p_demand_id);
    return false;
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands set status = 'Pending Approval', updated_by = coalesce(current_person_id(), updated_by)
  where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  v_product := (select product_name from it.products where id = v_demand.product_id);
  for v_person in select person_id from it.demand_approvers_for(v_demand.department_id) loop
    if v_person is distinct from v_demand.requested_by_person_id then
      perform it.notify_demand_person(v_person, 'demand_approval',
        format('Approval needed: demand %s', v_demand.demand_number),
        format('%s × %s for %s. Justification: %s', v_demand.quantity, v_product,
               (select name from org_units where id = v_demand.department_id), v_demand.justification),
        v_demand.id);
    end if;
  end loop;
  return true;
end;
$$;

drop function it.self_approval_allowed();

alter table it.procurement_settings drop column allow_self_approval;
