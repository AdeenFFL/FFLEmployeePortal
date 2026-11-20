-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Takes the live database from the first draft of javaria_it_0023 (repair bills going
--              straight to Finance) to the agreed design (repairs are demands). Inventory and
--              Procurement working as one; see the header of javaria_it_0023 for how it works.
-- Depends on:  javaria_it_0023 (either version)
-- Applied to live DB: YES (2026-11-10, by Javaria, via Supabase SQL Editor)
--
-- Why this file exists: an earlier draft of 0023 was run on the live database on 2026-11-06. 0023
-- was then rewritten, so running it again fails ("function can_see_site_inventory already exists").
-- Run THIS file on the live database, not 0023. Everything here is safe on a database that already
-- has the final 0023, so a fresh database can run 0023 and then this.
--
-- Removed from the draft: it.open_repair, it.close_repair, it.resend_repair_bill, repair bills on
-- it.invoices (maintenance_id), the demand-category block. It stops, changing nothing, if a repair
-- bill already exists.
-- it.invoice_event, it.close_demand_if_complete, it.send_payment_reference and
-- it.add_payment_document keep the draft's extra null checks: they do no harm with no repair bills.
--
-- Policies REPLACED: invoices select, payments select.

begin;

-- ===========================================================================
-- PART A — Remove the draft's direct-to-Finance repair bills.
-- ===========================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'it' and table_name = 'invoices' and column_name = 'maintenance_id') then
    if exists (select 1 from it.invoices where maintenance_id is not null) then
      raise exception 'Repair bills exist in it.invoices. Tell Claude before going on; nothing was changed';
    end if;
  end if;
  if exists (select 1 from it.documents where entity_type = 'repair') then
    raise exception 'Repair bill files exist in it.documents. Tell Claude before going on; nothing was changed';
  end if;
end;
$$;

drop function if exists it.close_repair(uuid, text, date, text, uuid, jsonb, numeric, text, date, text, text, text, bigint);
drop function if exists it.resend_repair_bill(uuid, numeric, text, date);
drop function if exists it.open_repair(uuid, text, text, text, date, uuid, uuid);
drop function if exists it.link_demand_to_repair(uuid, uuid);

drop policy if exists "repair bill documents" on it.documents;
drop policy if exists "it-documents insert repair files" on storage.objects;

drop policy if exists "invoices readable by procurement, approvers and finance" on it.invoices;
create policy "invoices readable by procurement, approvers and finance" on it.invoices
  for select to authenticated
  using (deleted_at is null and it.can_see_demand_finances(demand_id));

drop policy if exists "payments readable by procurement, approvers and finance" on it.payments;
create policy "payments readable by procurement, approvers and finance" on it.payments
  for select to authenticated
  using (deleted_at is null and it.can_see_demand_finances(demand_id));

drop function if exists it.can_see_repair_bills();

alter table it.invoices drop constraint if exists invoices_source;
drop index if exists it.invoices_one_per_repair;
alter table it.invoices drop column if exists maintenance_id;
alter table it.invoices alter column receiving_id set not null;
alter table it.invoices alter column demand_id set not null;
alter table it.payments alter column demand_id set not null;

alter table it.documents drop constraint if exists documents_entity_type_check;
alter table it.documents add constraint documents_entity_type_check
  check (entity_type in ('demand', 'receiving', 'invoice', 'payment', 'asset'));

-- The draft's triggers refused the Repair, Maintenance and Fix categories.
drop trigger if exists trg_demands_guard_links on it.demands;
drop trigger if exists trg_demands_guard_category_change on it.demands;
drop function if exists it.demands_guard_links();
drop function if exists it.demands_guard_category_change();

-- ===========================================================================
-- PART B — Links between demands, repairs, assets and tickets.
-- ===========================================================================

-- Hidden service products: see the note at the top.
alter table it.products
  add column if not exists service_category text unique check (service_category in ('Repair', 'Maintenance', 'Fix'));

insert into it.products (product_name, category, unit, is_active, service_category) values
  ('Repair service', 'Service', 'Each', false, 'Repair'),
  ('Maintenance service', 'Service', 'Each', false, 'Maintenance'),
  ('Fix service', 'Service', 'Each', false, 'Fix')
on conflict (service_category) do nothing;

alter table it.demands
  add column if not exists asset_id uuid references it.assets(id),          -- the device a repair demand is for
  add column if not exists issue_type text,                                 -- what's wrong with it
  add column if not exists replaces_asset_id uuid references it.assets(id), -- Replace device
  add column if not exists ticket_id uuid references it.tickets(id);

create index if not exists demands_asset_idx on it.demands (asset_id) where asset_id is not null;
create index if not exists demands_replaces_asset_idx on it.demands (replaces_asset_id) where replaces_asset_id is not null;
create index if not exists demands_ticket_idx on it.demands (ticket_id) where ticket_id is not null;

alter table it.asset_maintenance
  add column if not exists kind text not null default 'Repair' check (kind in ('Repair', 'Service')),
  add column if not exists ticket_id uuid references it.tickets(id),
  add column if not exists demand_id uuid references it.demands(id);

alter table it.asset_maintenance drop constraint if exists asset_maintenance_vendor_fk;
alter table it.asset_maintenance
  add constraint asset_maintenance_vendor_fk foreign key (vendor_id) references it.vendors(id);

create index if not exists asset_maintenance_demand_idx on it.asset_maintenance (demand_id);
create index if not exists asset_maintenance_ticket_idx on it.asset_maintenance (ticket_id);

-- A spare part on order for a repair.
alter table it.demands add column if not exists maintenance_id uuid references it.asset_maintenance(id);
create index if not exists demands_maintenance_idx on it.demands (maintenance_id) where maintenance_id is not null;

-- Parts used in a repair: the ledger row says which repair it went into.
alter table it.stock_movements add column if not exists maintenance_id uuid references it.asset_maintenance(id);
create index if not exists stock_movements_maintenance_idx on it.stock_movements (maintenance_id)
  where maintenance_id is not null;

-- ===========================================================================
-- PART C — Ticket helpers.
-- ===========================================================================

create or replace function it.ticket_note(p_ticket_id uuid, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into it.ticket_updates (ticket_id, author_person_id, update_type, body)
  values (p_ticket_id, current_person_id(), 'system', p_body);
$$;

revoke all on function it.ticket_note(uuid, text) from public;

-- Resolve a ticket from a repair or a replacement. The person doing it may not be the ticket's
-- assignee, so this is a trusted update; the ticket's own triggers still write the timeline and ask
-- the requester to confirm. A ticket already resolved or closed is left as it is.
create or replace function it.resolve_ticket_from_asset(p_ticket_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ticket_id is null then
    return;
  end if;
  perform set_config('it.ticket_system', 'on', true);
  update it.tickets
     set status = 'Resolved', resolution_notes = p_notes
   where id = p_ticket_id and status not in ('Resolved', 'Closed');
  perform set_config('it.ticket_system', 'off', true);
end;
$$;

revoke all on function it.resolve_ticket_from_asset(uuid, text) from public;

-- ===========================================================================
-- PART D — Repair demands.
-- ===========================================================================

-- Same as javaria_it_0020, plus: links only come from the trusted functions below, a repair needs a
-- device, and a repair's estimate is typed in (there's no product price to copy).
create or replace function it.demands_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_company uuid;
  v_home_site uuid;
  v_price numeric(12, 2);
  v_active boolean;
begin
  new.requested_by_person_id := coalesce(v_actor, new.requested_by_person_id);
  if new.requested_by_person_id is null then
    raise exception 'A demand needs a requester';
  end if;

  if coalesce(current_setting('it.linked_demand', true), '') <> 'on' then
    new.asset_id := null;
    new.issue_type := null;
    new.replaces_asset_id := null;
    new.ticket_id := null;
  end if;
  if new.demand_category in ('Repair', 'Maintenance', 'Fix') and new.asset_id is null then
    raise exception 'A repair needs a device: choose it on Raise Demand, or use Send for repair on the ticket';
  end if;

  select company_id, site_id into v_company, v_home_site
  from persons where id = new.requested_by_person_id;

  new.company_id := v_company;
  new.site_id := coalesce(new.site_id, v_home_site);
  if new.site_id is null then
    raise exception 'Please choose the site this demand is for';
  end if;
  perform it.check_org_unit(new.site_id, 'Site', 'site');
  perform it.check_org_unit(new.department_id, 'Department', 'department');

  if v_actor is not null
     and new.site_id is distinct from v_home_site
     and not has_permission('it.demands.read_all')
     and not it.is_site_member(new.site_id) then
    raise exception 'You can only raise demands for your own site';
  end if;

  if new.asset_id is null then
    select is_active, coalesce(current_price, purchase_price) into v_active, v_price
    from it.products where id = new.product_id;
    if not coalesce(v_active, false) then
      raise exception 'Please choose an active product from the Product Master';
    end if;
  else
    v_price := new.estimated_unit_price;
  end if;

  -- BRD §5.5.2: the category is chosen on the form (mandatory).
  if new.demand_category is null then
    raise exception 'Please choose the demand category';
  end if;

  new.justification := trim(new.justification);
  new.estimated_unit_price := v_price;
  new.status := 'Categorized';
  new.categorized_at := now();
  new.categorized_by := new.requested_by_person_id;
  new.vendor_id := null;
  new.approved_quantity := null;
  new.agreed_unit_price := null;
  new.received_quantity := 0;
  new.expected_delivery_date := null;
  new.vendor_assigned_at := null;
  new.vendor_assigned_by := null;
  new.follow_up_on := null;
  new.approval_follow_up_on := null;
  new.stock_note := null;
  new.stock_updated_at := null;
  new.stock_updated_by := null;
  new.closed_at := null;
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.cancellation_reason := null;
  new.deleted_at := null;
  new.created_at := now();
  new.created_by := new.requested_by_person_id;
  new.updated_by := new.requested_by_person_id;
  return new;
end;
$$;

-- The links never change after raising, and a demand can't become or stop being a repair.
create or replace function it.demands_guard_links()
returns trigger
language plpgsql
as $$
begin
  new.asset_id := old.asset_id;
  new.issue_type := old.issue_type;
  new.replaces_asset_id := old.replaces_asset_id;
  new.ticket_id := old.ticket_id;
  if new.demand_category is distinct from old.demand_category
     and (old.asset_id is not null or new.demand_category in ('Repair', 'Maintenance', 'Fix')) then
    raise exception 'A repair can''t be changed to or from another category. Cancel it and raise a new demand';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_demands_guard_links on it.demands;
create trigger trg_demands_guard_links
  before update on it.demands
  for each row execute function it.demands_guard_links();

-- The asset goes In Repair as soon as the demand exists, so nobody hands it out meanwhile.
create or replace function it.open_demand_repair(p_demand it.demands)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_person_id();
  v_asset it.assets%rowtype;
begin
  select * into v_asset from it.assets where id = p_demand.asset_id for update;
  if not found or v_asset.deleted_at is not null then
    raise exception 'Asset not found';
  end if;
  if v_asset.status in ('Retired', 'Disposed', 'Lost') then
    raise exception 'An asset that is % can''t go for repair', v_asset.status;
  end if;
  if v_asset.status = 'In Repair' then
    raise exception '% is already in repair', v_asset.asset_tag;
  end if;

  insert into it.asset_maintenance (
    asset_id, company_id, site_id, kind, ticket_id, demand_id, issue_type, description, created_by, updated_by)
  values (
    v_asset.id, v_asset.company_id, v_asset.site_id,
    case when p_demand.demand_category = 'Maintenance' then 'Service' else 'Repair' end,
    p_demand.ticket_id, p_demand.id, p_demand.issue_type, p_demand.justification, v_me, v_me);

  update it.assets set status = 'In Repair', updated_by = v_me where id = v_asset.id;

  if p_demand.ticket_id is not null then
    perform it.ticket_note(p_demand.ticket_id,
      format('%s sent for repair on demand %s: %s', v_asset.asset_tag, p_demand.demand_number, p_demand.issue_type));
    update it.tickets set status = 'On Hold'
     where id = p_demand.ticket_id and status not in ('Resolved', 'Closed', 'On Hold');
  end if;
end;
$$;

revoke all on function it.open_demand_repair(it.demands) from public;

-- Finish the repair record and put the asset back with its holder, or in stock.
create or replace function it.finish_demand_repair(
  p_demand_id uuid,
  p_resolution text,
  p_returned_date date,
  p_cost numeric,
  p_vendor_id uuid
)
returns it.asset_maintenance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := current_person_id();
  v_m it.asset_maintenance%rowtype;
begin
  update it.asset_maintenance
     set status = 'Completed', resolution = p_resolution, cost = coalesce(p_cost, 0),
         returned_date = greatest(p_returned_date, service_date), vendor_id = p_vendor_id, updated_by = v_me
   where demand_id = p_demand_id and status = 'Open'
  returning * into v_m;
  if not found then
    return null;
  end if;

  update it.assets
     set status = case when exists (
           select 1 from it.asset_assignments
            where asset_id = v_m.asset_id and return_date is null) then 'In Use' else 'Unassigned' end,
         updated_by = v_me
   where id = v_m.asset_id and status = 'In Repair';
  return v_m;
end;
$$;

revoke all on function it.finish_demand_repair(uuid, text, date, numeric, uuid) from public;

create or replace function it.demands_open_repair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.asset_id is not null then
    perform it.open_demand_repair(new);
  end if;
  return null;
end;
$$;

revoke all on function it.demands_open_repair() from public;

drop trigger if exists trg_demands_open_repair on it.demands;
create trigger trg_demands_open_repair
  after insert on it.demands
  for each row execute function it.demands_open_repair();

-- Rejected or cancelled → the asset is released and the ticket goes back to being worked. A rejected
-- demand that is revised sends the asset back in.
create or replace function it.demands_sync_repair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if new.asset_id is null or new.status is not distinct from old.status then
    return null;
  end if;

  if new.status in ('Rejected', 'Cancelled') then
    v_reason := format('Repair %s on demand %s', lower(new.status), new.demand_number);
    perform it.finish_demand_repair(new.id, v_reason, current_date, 0, null);
    if new.ticket_id is not null then
      perform it.ticket_note(new.ticket_id, v_reason);
      update it.tickets set status = 'In Progress' where id = new.ticket_id and status = 'On Hold';
    end if;
  elsif old.status = 'Rejected' and new.status in ('Categorized', 'Pending Approval') then
    perform it.open_demand_repair(new);
  end if;
  return null;
end;
$$;

revoke all on function it.demands_sync_repair() from public;

drop trigger if exists trg_demands_sync_repair on it.demands;
create trigger trg_demands_sync_repair
  after update of status on it.demands
  for each row execute function it.demands_sync_repair();

-- Raise a repair demand, from the ticket's Send for repair or from Raise Demand.
create or replace function it.raise_repair_demand(
  p_asset_id uuid,
  p_category text,
  p_issue_type text,
  p_justification text,
  p_department_id uuid,
  p_estimate numeric,
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset it.assets%rowtype;
  v_id uuid;
begin
  if current_person_id() is null
     or not has_permission('it.demands.create') or not has_permission('it.maintenance.update') then
    raise exception 'Only IT staff can send a device for repair' using errcode = '42501';
  end if;
  if p_category not in ('Repair', 'Maintenance', 'Fix') then
    raise exception 'Choose Repair, Maintenance or Fix';
  end if;
  if coalesce(btrim(p_issue_type), '') = '' then
    raise exception 'Say what is wrong with the device';
  end if;
  if p_estimate is not null and p_estimate < 0 then
    raise exception 'The estimate can''t be negative';
  end if;
  select * into v_asset from it.assets where id = p_asset_id and deleted_at is null;
  if not found then
    raise exception 'Asset not found';
  end if;
  if v_asset.site_id is null then
    raise exception 'The device has no site. Set its site first';
  end if;
  if p_ticket_id is not null and not exists (
    select 1 from it.tickets where id = p_ticket_id and linked_asset_id = p_asset_id
  ) then
    raise exception 'That ticket is not linked to this device';
  end if;

  perform set_config('it.linked_demand', 'on', true);
  insert into it.demands (
    product_id, requested_by_person_id, department_id, site_id, quantity, justification,
    demand_category, estimated_unit_price, asset_id, issue_type, ticket_id)
  values (
    (select id from it.products where service_category = p_category),
    current_person_id(), p_department_id, v_asset.site_id, 1,
    coalesce(nullif(btrim(p_justification), ''), btrim(p_issue_type)),
    p_category, round(p_estimate, 2), p_asset_id, btrim(p_issue_type), p_ticket_id)
  returning id into v_id;
  perform set_config('it.linked_demand', 'off', true);
  return v_id;
end;
$$;

revoke all on function it.raise_repair_demand(uuid, text, text, text, uuid, numeric, uuid) from public;
grant execute on function it.raise_repair_demand(uuid, text, text, text, uuid, numeric, uuid) to authenticated;

-- Device back takes the place of a delivery. It writes a normal receiving row, so the invoice,
-- approval, Finance and closing steps run as for any purchase; the bill's total becomes the repair's
-- cost (trigger below). With p_no_bill (warranty, no charge) the demand closes here instead.
--   p_parts: [{"product_id": "…", "quantity": 1}, …] from the stock of the demand's site.
create or replace function it.record_device_back(
  p_demand_id uuid,
  p_resolution text,
  p_returned_date date,
  p_condition text,
  p_gate_pass_no text,
  p_remarks text,
  p_parts jsonb,
  p_no_bill boolean
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

  if v_demand.ticket_id is not null then
    perform it.ticket_note(v_demand.ticket_id, format('%s back from repair: %s', v_asset.asset_tag, btrim(p_resolution)));
    perform it.resolve_ticket_from_asset(v_demand.ticket_id, btrim(p_resolution));
  elsif v_holder is not null then
    perform it.notify(v_holder, 'asset_back', format('%s is back from repair', v_asset.asset_tag),
      btrim(p_resolution), '/it/my-assets');
  end if;
  return v_receiving;
end;
$$;

revoke all on function it.record_device_back(uuid, text, date, text, text, text, jsonb, boolean) from public;
grant execute on function it.record_device_back(uuid, text, date, text, text, text, jsonb, boolean) to authenticated;

-- The repair's cost is the bill's total, entered once on the invoice.
create or replace function it.invoices_set_repair_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update it.asset_maintenance
     set cost = new.invoice_amount
   where demand_id = new.demand_id;
  return null;
end;
$$;

revoke all on function it.invoices_set_repair_cost() from public;

drop trigger if exists trg_invoices_set_repair_cost on it.invoices;
create trigger trg_invoices_set_repair_cost
  after insert or update of invoice_amount on it.invoices
  for each row execute function it.invoices_set_repair_cost();

-- A repair has no goods through the gate, so it needs no gate pass to reach Finance.
create or replace function it.receiving_has_gate_proof(p_receiving_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.receiving_records r
    join it.demands d on d.id = r.demand_id
    where r.id = p_receiving_id
      and (d.asset_id is not null
           or nullif(trim(r.gate_pass_no), '') is not null
           or exists (select 1 from it.documents doc
                      where doc.entity_type = 'receiving' and doc.entity_id = r.id and doc.doc_type = 'Gate Pass'))
  );
$$;

-- Same as javaria_it_0022, but a repair's "delivery" adds nothing to stock.
create or replace function it.receiving_stock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_asset uuid;
begin
  if new.accepted_quantity <= 0 or new.site_id is null then
    return new;
  end if;
  select product_id, asset_id into v_product, v_asset from it.demands where id = new.demand_id;
  if v_asset is not null or v_product is null or it.product_is_fixed_asset(v_product) then
    return new;
  end if;

  perform it.write_stock_movement(
    v_product, new.site_id, 'Received', new.accepted_quantity, new.received_date,
    new.id, new.demand_id, null, 'Delivery ' || new.receiving_number);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (new.demand_id, current_person_id(), 'system',
          format('%s added to stock from %s', new.accepted_quantity, new.receiving_number));
  return new;
end;
$$;

-- ===========================================================================
-- PART E — Replace device.
-- ===========================================================================

-- Ticket → ready-made demand: General purchase, same site, quantity 1, linked to the old asset.
-- The normal approval flow takes over from here.
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
  if v_asset.status in ('Retired', 'Disposed', 'Lost') then
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

revoke all on function it.raise_replacement_demand(uuid, uuid, uuid, text) from public;
grant execute on function it.raise_replacement_demand(uuid, uuid, uuid, text) to authenticated;

-- The new device is assigned → the old one reaches its end of life, and the ticket is resolved.
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

revoke all on function it.retire_replaced_asset() from public;

drop trigger if exists trg_retire_replaced_asset on it.asset_assignments;
create trigger trg_retire_replaced_asset
  after insert on it.asset_assignments
  for each row execute function it.retire_replaced_asset();

commit;
