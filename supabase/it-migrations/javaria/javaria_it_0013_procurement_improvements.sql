-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement — improvements to Phases 1–4 before invoices
--              (09-it-procurement-plan.md §5 "Improvements 2026-10-23")
-- Depends on:  javaria_it_0009 … javaria_it_0012
-- Applied to live DB: YES (confirmed live 2026-10-28 by read-only check)
--
-- What this does
--   1. Agreed unit price: the price agreed with the vendor, set at vendor assignment (defaults to
--      the estimate). Phase 5 checks invoices against it, not against the Product Master price.
--   2. Accepted quantity: a delivery records what arrived (received_quantity) AND what was
--      accepted (accepted_quantity). Damaged / rejected items don't count, stay "still due" and
--      keep the vendor follow-up going. demands.received_quantity now means the ACCEPTED total.
--   3. Cancel after approval: site procurement can cancel an Approved / Partially Approved /
--      Assigned to Vendor / Rejected demand, with a reason, as long as nothing has been accepted.
--   4. Approval reminders: a demand waiting in Pending Approval reminds the department's approvers
--      every reminder interval (same daily sweep as receiving follow-ups).
--   5. Revise & resubmit: site procurement can revise a Rejected demand (quantity / justification)
--      → back to Categorized, ready to send for approval again. The earlier decision stays in
--      it.demand_approvals and on the timeline.
--   (6–8 are screen-only: needs-action queue view, read-only masters, product search.)
--
-- Functions REPLACED / RE-SIGNED: it.assign_demand_vendor (adds p_agreed_price),
-- it.record_receiving (adds p_accepted_quantity), it.demands_before_update (cancel rule),
-- it.notify_receiving_followups (adds approval reminders).

-- ===========================================================================
-- PART A — Columns.
-- ===========================================================================

alter table it.demands
  add column agreed_unit_price numeric(12, 2) check (agreed_unit_price is null or agreed_unit_price >= 0),
  add column approval_follow_up_on date;

comment on column it.demands.received_quantity is
  'Total ACCEPTED quantity across deliveries (damaged / rejected items excluded) — javaria_it_0013';

alter table it.receiving_records add column accepted_quantity int;
update it.receiving_records set accepted_quantity = received_quantity where accepted_quantity is null;
alter table it.receiving_records
  alter column accepted_quantity set not null,
  add constraint receiving_records_accepted_le_received
    check (accepted_quantity >= 0 and accepted_quantity <= received_quantity);

-- Existing approved demands with a vendor: agreed price = the estimate.
update it.demands set agreed_unit_price = estimated_unit_price
where vendor_id is not null and agreed_unit_price is null;

-- Demands already waiting for approval get a first reminder date.
update it.demands
   set approval_follow_up_on = current_date + coalesce(
         (select reminder_interval_days from it.procurement_settings where id), 2)
 where status = 'Pending Approval' and approval_follow_up_on is null;

-- Reminder date follows the status (before-update, also on trusted system updates).
create function it.demands_track_approval_follow_up()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Pending Approval' and old.status is distinct from 'Pending Approval' then
    new.approval_follow_up_on := current_date + it.reminder_interval_days();
  elsif new.status <> 'Pending Approval' then
    new.approval_follow_up_on := null;
  elsif coalesce(current_setting('it.demand_system', true), '') <> 'on' then
    -- Only the sweep moves the reminder date while waiting.
    new.approval_follow_up_on := old.approval_follow_up_on;
  end if;
  return new;
end;
$$;

create trigger trg_demands_track_approval_follow_up
  before update on it.demands
  for each row execute function it.demands_track_approval_follow_up();

-- ===========================================================================
-- PART B — Vendor assignment with agreed price (replaces the 4-argument version).
-- ===========================================================================

drop function it.assign_demand_vendor(uuid, uuid, date, text);

create function it.assign_demand_vendor(
  p_demand_id uuid,
  p_vendor_id uuid,
  p_expected_date date,
  p_agreed_price numeric,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_vendor text;
  v_price numeric(12, 2);
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can assign a vendor';
  end if;
  if v_demand.status not in ('Approved', 'Partially Approved', 'Assigned to Vendor', 'Partially Received') then
    raise exception 'A vendor can be assigned only after approval and before everything is received (demand is %)',
      v_demand.status;
  end if;
  select vendor_name into v_vendor from it.vendors where id = p_vendor_id and is_active;
  if v_vendor is null then
    raise exception 'Please choose an active vendor from the Vendor Master';
  end if;
  if p_expected_date is not null and p_expected_date < current_date - 30 then
    raise exception 'The expected delivery date looks wrong';
  end if;
  if p_agreed_price is not null and (p_agreed_price < 0 or p_agreed_price > 9999999999.99) then
    raise exception 'The agreed price must be a positive amount';
  end if;
  v_price := round(coalesce(p_agreed_price, v_demand.agreed_unit_price, v_demand.estimated_unit_price), 2);

  if p_vendor_id is not distinct from v_demand.vendor_id
     and p_expected_date is not distinct from v_demand.expected_delivery_date
     and v_price is not distinct from v_demand.agreed_unit_price then
    raise exception 'Nothing changed';
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set vendor_id = p_vendor_id,
         expected_delivery_date = p_expected_date,
         agreed_unit_price = v_price,
         vendor_assigned_at = case when p_vendor_id is distinct from vendor_id then now() else vendor_assigned_at end,
         vendor_assigned_by = case when p_vendor_id is distinct from vendor_id then v_actor else vendor_assigned_by end,
         follow_up_on = coalesce(p_expected_date, current_date + it.reminder_interval_days()),
         status = case when status in ('Approved', 'Partially Approved') then 'Assigned to Vendor' else status end,
         updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          case when v_demand.vendor_id is null then 'Ordered from '
               when p_vendor_id is distinct from v_demand.vendor_id then 'Vendor changed to '
               else 'Order updated: ' end
          || v_vendor
          || coalesce(', agreed Rs ' || to_char(v_price, 'FM999,999,999,990.00') || ' each', '')
          || coalesce(', expected ' || to_char(p_expected_date, 'DD Mon YYYY'), '')
          || coalesce(' — ' || nullif(trim(p_note), ''), ''));
end;
$$;

revoke all on function it.assign_demand_vendor(uuid, uuid, date, numeric, text) from public;
grant execute on function it.assign_demand_vendor(uuid, uuid, date, numeric, text) to authenticated;

-- ===========================================================================
-- PART C — Receiving with accepted quantity (replaces the 7-argument version).
-- ===========================================================================

drop function it.record_receiving(uuid, date, int, text, text, text, text);

create function it.record_receiving(
  p_demand_id uuid,
  p_received_date date,
  p_quantity int,
  p_accepted_quantity int,
  p_condition text,
  p_challan_no text,
  p_gate_pass_no text,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_target int;
  v_due int;
  v_accepted int;
  v_total int;
  v_id uuid;
  v_status text;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can record receiving';
  end if;
  if v_demand.status not in ('Assigned to Vendor', 'Partially Received') then
    raise exception 'Assign a vendor before recording a delivery (demand is %)', v_demand.status;
  end if;
  if p_received_date is null or p_received_date > current_date then
    raise exception 'The received date can''t be in the future';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Enter the quantity delivered (0 if nothing arrived)';
  end if;
  v_accepted := coalesce(p_accepted_quantity, p_quantity);
  if v_accepted < 0 or v_accepted > p_quantity then
    raise exception 'Accepted quantity must be between 0 and the % delivered', p_quantity;
  end if;
  if p_condition not in ('Good', 'Partially Damaged', 'Damaged') then
    raise exception 'Choose the condition of the goods';
  end if;

  v_target := coalesce(v_demand.approved_quantity, v_demand.quantity);
  v_due := v_target - v_demand.received_quantity;
  if p_quantity > v_due then
    raise exception 'Only % still due — record the extra items in the remarks and return them', v_due;
  end if;
  if (p_quantity = 0 or v_accepted < p_quantity) and coalesce(trim(p_remarks), '') = '' then
    raise exception 'Please note why % — the vendor follow-up uses it',
      case when p_quantity = 0 then 'nothing was received' else 'some items weren''t accepted' end;
  end if;

  v_total := v_demand.received_quantity + v_accepted;
  v_status := case when v_accepted = 0 then 'Not Received'
                   when v_total >= v_target then 'Full'
                   else 'Partial' end;

  insert into it.receiving_records (
    demand_id, vendor_id, received_by_person_id, received_date, received_quantity, accepted_quantity,
    condition, status, delivery_challan_no, gate_pass_no, remarks, site_id, company_id, created_by, updated_by)
  values (
    p_demand_id, v_demand.vendor_id, v_actor, p_received_date, p_quantity, v_accepted,
    p_condition, v_status, nullif(trim(p_challan_no), ''), nullif(trim(p_gate_pass_no), ''),
    nullif(trim(p_remarks), ''), v_demand.site_id, v_demand.company_id, v_actor, v_actor)
  returning id into v_id;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set received_quantity = v_total,
         status = case when v_total >= v_target then 'Received'
                       when v_total > 0 then 'Partially Received'
                       else status end,
         follow_up_on = case when v_total >= v_target then null
                             else p_received_date + it.reminder_interval_days() end,
         updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          format('Delivery %s: %s delivered, %s accepted (%s of %s in total), condition %s',
                 (select receiving_number from it.receiving_records where id = v_id),
                 p_quantity, v_accepted, v_total, v_target, p_condition)
          || case when v_total < v_target then format(' — %s still due', v_target - v_total) else '' end
          || case when nullif(trim(p_gate_pass_no), '') is null and p_quantity > 0
                  then ' · gate pass pending' else '' end);

  return v_id;
end;
$$;

revoke all on function it.record_receiving(uuid, date, int, int, text, text, text, text) from public;
grant execute on function it.record_receiving(uuid, date, int, int, text, text, text, text) to authenticated;

-- ===========================================================================
-- PART D — Cancel rule (replaces javaria_it_0011's trigger function; only the Cancelled branch
-- changed: site procurement may cancel up to Assigned to Vendor, and a Rejected demand, while
-- nothing has been accepted).
-- ===========================================================================

create or replace function it.demands_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_owner boolean;
  v_process boolean;
  v_price numeric(12, 2);
  v_active boolean;
  v_consumable_path boolean;
begin
  if v_actor is null or coalesce(current_setting('it.demand_system', true), '') = 'on' then
    return new;
  end if;

  new.demand_number := old.demand_number;
  new.requested_by_person_id := old.requested_by_person_id;
  new.company_id := old.company_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.vendor_id := old.vendor_id;
  new.approved_quantity := old.approved_quantity;
  new.agreed_unit_price := old.agreed_unit_price;
  new.received_quantity := old.received_quantity;
  new.expected_delivery_date := old.expected_delivery_date;
  new.vendor_assigned_at := old.vendor_assigned_at;
  new.vendor_assigned_by := old.vendor_assigned_by;
  new.follow_up_on := old.follow_up_on;
  new.deleted_at := old.deleted_at;
  new.categorized_at := old.categorized_at;
  new.categorized_by := old.categorized_by;
  new.stock_updated_at := old.stock_updated_at;
  new.stock_updated_by := old.stock_updated_by;
  new.closed_at := old.closed_at;
  new.cancelled_at := old.cancelled_at;
  new.cancelled_by := old.cancelled_by;

  if old.status in ('Closed', 'Cancelled') then
    raise exception 'Demand % is % and can''t be changed', old.demand_number, lower(old.status);
  end if;

  v_owner := old.requested_by_person_id = v_actor;
  v_process := it.can_process_demand(old.site_id);

  if new.product_id is distinct from old.product_id
     or new.quantity is distinct from old.quantity
     or new.justification is distinct from old.justification
     or new.department_id is distinct from old.department_id
     or new.site_id is distinct from old.site_id then
    if old.status <> 'Open' then
      raise exception 'Only an Open demand can be edited';
    end if;
    if not (v_owner or v_process) then
      raise exception 'You can''t edit this demand';
    end if;
    if new.site_id is distinct from old.site_id then
      if not has_permission('it.demands.read_all') then
        raise exception 'Only all-sites procurement staff can move a demand to another site';
      end if;
      perform it.check_org_unit(new.site_id, 'Site', 'site');
    end if;
    if new.department_id is distinct from old.department_id then
      perform it.check_org_unit(new.department_id, 'Department', 'department');
    end if;
    if new.product_id is distinct from old.product_id then
      select is_active, coalesce(current_price, purchase_price) into v_active, v_price
      from it.products where id = new.product_id;
      if not coalesce(v_active, false) then
        raise exception 'Please choose an active product from the Product Master';
      end if;
      new.estimated_unit_price := v_price;
    else
      new.estimated_unit_price := old.estimated_unit_price;
    end if;
    new.justification := trim(new.justification);
  else
    new.estimated_unit_price := old.estimated_unit_price;
  end if;

  if new.demand_category is distinct from old.demand_category then
    if not v_process then
      raise exception 'Only the site''s procurement staff can categorise a demand';
    end if;
    if old.status not in ('Open', 'Categorized') then
      raise exception 'The category can''t change once the demand has moved on';
    end if;
    if new.demand_category is null then
      raise exception 'Please choose a category';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'Categorized' and old.status = 'Open' then
      if not v_process then
        raise exception 'Only the site''s procurement staff can categorise a demand';
      end if;
      if new.demand_category is null then
        raise exception 'Please choose a category';
      end if;
      new.categorized_at := now();
      new.categorized_by := v_actor;

    elsif new.status = 'Cancelled' then
      if not ((v_owner and old.status = 'Open')
              or (v_process
                  and old.status in ('Open', 'Categorized', 'Pending Approval', 'Approved',
                                     'Partially Approved', 'Assigned to Vendor', 'Rejected')
                  and old.received_quantity = 0)) then
        raise exception 'This demand can''t be cancelled at this stage%',
          case when old.received_quantity > 0 then ' — items have already been received' else '' end;
      end if;
      if coalesce(trim(new.cancellation_reason), '') = '' then
        raise exception 'Please give a reason for cancelling';
      end if;
      new.cancellation_reason := trim(new.cancellation_reason);
      new.cancelled_at := now();
      new.cancelled_by := v_actor;
      new.follow_up_on := null;

    elsif new.status = 'Stock Updated' and old.status = 'Categorized' then
      select consumable_path_enabled into v_consumable_path from it.procurement_settings where id;
      if not v_process then
        raise exception 'Only the site''s procurement staff can record the stock entry';
      end if;
      if new.demand_category is distinct from 'Consumable' or not coalesce(v_consumable_path, false) then
        raise exception 'Only consumable demands skip approval (and only when the consumable path is enabled)';
      end if;
      if coalesce(trim(new.stock_note), '') = '' then
        raise exception 'Please note what was issued from stock';
      end if;
      new.stock_note := trim(new.stock_note);
      new.stock_updated_at := now();
      new.stock_updated_by := v_actor;

    elsif new.status = 'Closed' and old.status = 'Stock Updated' then
      if not v_process then
        raise exception 'Only the site''s procurement staff can close a demand';
      end if;
      new.closed_at := now();

    else
      raise exception 'A demand can''t move from % to % here', old.status, new.status;
    end if;
  else
    new.stock_note := old.stock_note;
    new.cancellation_reason := old.cancellation_reason;
  end if;

  new.updated_by := v_actor;
  return new;
end;
$$;

-- ===========================================================================
-- PART E — Revise & resubmit a rejected demand.
-- ===========================================================================

create function it.revise_rejected_demand(
  p_demand_id uuid,
  p_quantity int,
  p_justification text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_justification text := nullif(trim(coalesce(p_justification, '')), '');
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can revise a demand';
  end if;
  if v_demand.status <> 'Rejected' then
    raise exception 'Only a rejected demand can be revised (it is %)', v_demand.status;
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'Quantity must be from 1 to 100,000';
  end if;
  if v_justification is null then
    raise exception 'Justification can''t be empty';
  end if;
  if v_note is null then
    raise exception 'Please say what changed for the approver';
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set quantity = p_quantity,
         justification = v_justification,
         approved_quantity = null,
         status = 'Categorized',
         updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          format('Revised after rejection (quantity %s → %s): %s', v_demand.quantity, p_quantity, v_note));
end;
$$;

revoke all on function it.revise_rejected_demand(uuid, int, text, text) from public;
grant execute on function it.revise_rejected_demand(uuid, int, text, text) to authenticated;

-- ===========================================================================
-- PART F — Daily sweep: receiving follow-ups + approval reminders (same cron job as 0012:
--   select cron.schedule('it-receiving-followups', '0 9 * * *',
--                        $$select it.notify_receiving_followups()$$);).
-- ===========================================================================

create or replace function it.notify_receiving_followups()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
  v_person uuid;
  v_count int := 0;
  v_target int;
begin
  -- Deliveries due / short.
  for v_demand in
    select * from it.demands
    where deleted_at is null
      and status in ('Assigned to Vendor', 'Partially Received')
      and follow_up_on is not null
      and follow_up_on <= current_date
    for update skip locked
  loop
    v_target := coalesce(v_demand.approved_quantity, v_demand.quantity);
    perform it.notify_demand_processors(v_demand.site_id, 'demand_followup',
      format('Follow up delivery: demand %s', v_demand.demand_number),
      format('%s of %s accepted from %s%s.', v_demand.received_quantity, v_target,
             coalesce((select vendor_name from it.vendors where id = v_demand.vendor_id), 'the vendor'),
             coalesce(', expected ' || to_char(v_demand.expected_delivery_date, 'DD Mon YYYY'), '')),
      v_demand.id);

    perform set_config('it.demand_system', 'on', true);
    update it.demands set follow_up_on = current_date + it.reminder_interval_days() where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
    v_count := v_count + 1;
  end loop;

  -- Approvals waiting.
  for v_demand in
    select * from it.demands
    where deleted_at is null
      and status = 'Pending Approval'
      and approval_follow_up_on is not null
      and approval_follow_up_on <= current_date
    for update skip locked
  loop
    for v_person in select person_id from it.demand_approvers_for(v_demand.department_id) loop
      if v_person is distinct from v_demand.requested_by_person_id then
        perform it.notify_demand_person(v_person, 'demand_approval_reminder',
          format('Reminder: demand %s is waiting for your approval', v_demand.demand_number),
          format('%s × %s for %s is still waiting for a decision.', v_demand.quantity,
                 (select product_name from it.products where id = v_demand.product_id),
                 (select name from org_units where id = v_demand.department_id)),
          v_demand.id);
      end if;
    end loop;

    perform set_config('it.demand_system', 'on', true);
    update it.demands set approval_follow_up_on = current_date + it.reminder_interval_days()
    where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function it.notify_receiving_followups() from public;
