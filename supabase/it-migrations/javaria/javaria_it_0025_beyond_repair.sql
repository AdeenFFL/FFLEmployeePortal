-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Beyond repair at Device back (Inventory guide: "In repair → End of life, beyond repair").
--              The device comes back, is retired with its condition, its holder gives it up and is
--              told, and the ticket stays open for Replace device. Replace device now also works for
--              a device retired this way, and assigning the new one resolves the ticket.
-- Depends on:  javaria_it_0024_repairs_in_procurement.sql
-- Applied to live DB: NO
--
-- Functions REPLACED: it.record_device_back (new argument p_beyond_repair, so the old one is
-- dropped), it.raise_replacement_demand, it.retire_replaced_asset.

begin;

drop function if exists it.record_device_back(uuid, text, date, text, text, text, jsonb, boolean);

create function it.record_device_back(
  p_demand_id uuid,
  p_resolution text,
  p_returned_date date,
  p_condition text,
  p_gate_pass_no text,
  p_remarks text,
  p_parts jsonb,
  p_no_bill boolean,
  p_beyond_repair boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_asset it.assets%rowtype;
  v_repair it.asset_maintenance%rowtype;
  v_holder uuid;
  v_date date := coalesce(p_returned_date, current_date);
  v_receiving uuid;
  v_part jsonb;
  v_qty int;
  v_movement uuid;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found or v_demand.asset_id is null then
    raise exception 'This is not a repair demand';
  end if;
  if coalesce(btrim(p_resolution), '') = '' then
    raise exception 'Say how the device was fixed';
  end if;

  -- Who may do this, the status and the date are checked here.
  v_receiving := it.record_receiving(
    p_demand_id, v_date, 1, 1, p_condition, null, p_gate_pass_no,
    format('Device back: %s', btrim(p_resolution)) || coalesce(' — ' || nullif(btrim(p_remarks), ''), ''));

  select * into v_asset from it.assets where id = v_demand.asset_id for update;
  select person_id into v_holder from it.asset_assignments
   where asset_id = v_demand.asset_id and return_date is null;

  v_repair := it.finish_demand_repair(
    p_demand_id, btrim(p_resolution), v_date,
    case when coalesce(p_no_bill, false) then 0
         else coalesce(v_demand.agreed_unit_price, v_demand.estimated_unit_price) end,
    v_demand.vendor_id);

  for v_part in select * from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) loop
    v_qty := (v_part ->> 'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter how many of each part were used';
    end if;
    v_movement := it.write_stock_movement(
      (v_part ->> 'product_id')::uuid, v_demand.site_id, 'Issued', -v_qty, v_date,
      null, null, v_holder, format('Repair %s, %s', v_asset.asset_tag, v_demand.demand_number));
    update it.stock_movements set maintenance_id = v_repair.id where id = v_movement;
  end loop;

  if coalesce(p_no_bill, false) then
    perform set_config('it.demand_system', 'on', true);
    update it.demands
       set status = 'Closed', closed_at = now(), follow_up_on = null, updated_by = v_me
     where id = p_demand_id;
    perform set_config('it.demand_system', 'off', true);
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (p_demand_id, v_me, 'system', 'Device back with no bill — demand closed.');
  end if;

  -- Beyond repair: the device comes back but reaches its end of life. Its holder gives it up, and
  -- the ticket stays open so IT can use Replace device.
  if coalesce(p_beyond_repair, false) then
    update it.asset_maintenance
       set resolution = format('Beyond repair: %s', btrim(p_resolution)), updated_by = v_me
     where id = v_repair.id;
    update it.asset_assignments
       set status = 'Returned', return_date = greatest(v_date, assigned_date), returned_to_person_id = v_me,
           returned_condition = p_condition, remarks = 'Beyond repair', updated_by = v_me
     where asset_id = v_asset.id and return_date is null;
    update it.assets set status = 'Retired', condition = p_condition, updated_by = v_me where id = v_asset.id;

    if v_demand.ticket_id is not null then
      perform it.ticket_note(v_demand.ticket_id,
        format('%s is beyond repair and has been retired: %s. Use Replace device.', v_asset.asset_tag, btrim(p_resolution)));
      update it.tickets set status = 'In Progress' where id = v_demand.ticket_id and status = 'On Hold';
    end if;
    if v_holder is not null then
      perform it.notify(v_holder, 'asset_beyond_repair', format('%s can''t be repaired', v_asset.asset_tag),
        'IT will arrange a replacement.', '/it/my-assets');
    end if;
  elsif v_demand.ticket_id is not null then
    perform it.ticket_note(v_demand.ticket_id, format('%s back from repair: %s', v_asset.asset_tag, btrim(p_resolution)));
    perform it.resolve_ticket_from_asset(v_demand.ticket_id, btrim(p_resolution));
  elsif v_holder is not null then
    perform it.notify(v_holder, 'asset_back', format('%s is back from repair', v_asset.asset_tag),
      btrim(p_resolution), '/it/my-assets');
  end if;
  return v_receiving;
end;
$$;

revoke all on function it.record_device_back(uuid, text, date, text, text, text, jsonb, boolean, boolean) from public;
grant execute on function it.record_device_back(uuid, text, date, text, text, text, jsonb, boolean, boolean) to authenticated;

create or replace function it.raise_replacement_demand(
  p_ticket_id uuid,
  p_product_id uuid,
  p_department_id uuid,
  p_justification text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket it.tickets%rowtype;
  v_asset it.assets%rowtype;
  v_id uuid;
  v_number text;
begin
  if current_person_id() is null or not has_permission('it.demands.create') then
    raise exception 'You need permission to raise demands' using errcode = '42501';
  end if;
  select * into v_ticket from it.tickets where id = p_ticket_id;
  if not found or v_ticket.linked_asset_id is null then
    raise exception 'Link the device to the ticket first';
  end if;
  select * into v_asset from it.assets where id = v_ticket.linked_asset_id and deleted_at is null;
  if not found then
    raise exception 'The linked device no longer exists';
  end if;
  -- A device retired at Device back as beyond repair can still be replaced.
  if v_asset.status in ('Disposed', 'Lost') then
    raise exception 'This device is already %', v_asset.status;
  end if;
  if v_asset.site_id is null then
    raise exception 'The device has no site. Set its site first';
  end if;
  if not exists (
    select 1 from it.products
    where id = p_product_id and is_active and asset_type_id = v_asset.asset_type_id
  ) then
    raise exception 'Choose an active product of the same type as the old device';
  end if;
  if exists (
    select 1 from it.demands
    where replaces_asset_id = v_asset.id and deleted_at is null
      and status not in ('Closed', 'Cancelled', 'Rejected')
  ) then
    raise exception 'A replacement demand for this device is already open';
  end if;

  perform set_config('it.linked_demand', 'on', true);
  insert into it.demands (
    product_id, requested_by_person_id, department_id, site_id, quantity, justification,
    demand_category, replaces_asset_id, ticket_id)
  values (
    p_product_id, current_person_id(), p_department_id, v_asset.site_id, 1,
    coalesce(nullif(btrim(p_justification), ''),
             format('Replacement for %s (%s), ticket %s', v_asset.asset_tag, v_asset.asset_name, v_ticket.ticket_number)),
    'Open', v_asset.id, p_ticket_id)
  returning id, demand_number into v_id, v_number;
  perform set_config('it.linked_demand', 'off', true);

  perform it.ticket_note(p_ticket_id, format('Replacement demand %s raised for %s', v_number, v_asset.asset_tag));
  update it.tickets set status = 'On Hold'
   where id = p_ticket_id and status not in ('Resolved', 'Closed', 'On Hold');
  return v_id;
end;
$$;

create or replace function it.retire_replaced_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new it.assets%rowtype;
  v_demand it.demands%rowtype;
  v_old it.assets%rowtype;
  v_me uuid := current_person_id();
begin
  select * into v_new from it.assets where id = new.asset_id;
  if v_new.receiving_id is null then
    return null;
  end if;
  select d.* into v_demand
    from it.receiving_records r join it.demands d on d.id = r.demand_id
   where r.id = v_new.receiving_id and d.replaces_asset_id is not null;
  if not found then
    return null;
  end if;

  select * into v_old from it.assets where id = v_demand.replaces_asset_id for update;
  if v_old.status in ('Retired', 'Disposed', 'Lost') or v_old.deleted_at is not null then
    -- Already retired (beyond repair): nothing to retire, but the ticket is done.
    perform it.resolve_ticket_from_asset(v_demand.ticket_id, format('Replaced with %s', v_new.asset_tag));
    return null;
  end if;

  update it.asset_maintenance
     set status = 'Completed', resolution = format('Replaced by %s', v_new.asset_tag),
         returned_date = greatest(new.assigned_date, service_date), updated_by = v_me
   where asset_id = v_old.id and status = 'Open';

  update it.asset_assignments
     set status = 'Returned', return_date = greatest(new.assigned_date, assigned_date),
         returned_to_person_id = v_me, remarks = format('Replaced by %s', v_new.asset_tag), updated_by = v_me
   where asset_id = v_old.id and return_date is null;

  update it.assets set status = 'Retired', updated_by = v_me where id = v_old.id;

  perform it.resolve_ticket_from_asset(v_demand.ticket_id, format('Replaced with %s', v_new.asset_tag));
  return null;
end;
$$;

commit;
