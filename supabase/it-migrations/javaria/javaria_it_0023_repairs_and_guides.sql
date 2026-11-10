-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Inventory and Procurement working as one (decision 2026-11-06).
--              * Paid repairs are demands. Repair, Maintenance and Fix demands name a device instead
--                of a product, go through approval, vendor, invoice and Finance like any purchase,
--                and "Device back" takes the place of a delivery. Free in-house fixes stay on the
--                ticket and raise no demand.
--              * Inventory shows the repair: the asset goes In Repair when the demand is raised, and
--                the repair record on the asset (it.asset_maintenance) links to the demand.
--              * Replace device: a ready-made demand linked to the old asset; the old asset is
--                retired when the new one is assigned.
--              * Spare parts: a demand can name the repair it is for (demands.maintenance_id).
--              * Minimum stock per product per site.
--              * Asset tags: AST- plus six digits.
--              * Site scoping of assets, repairs and stock (it.assets.read_all = every site).
--              * Amounts: it.amounts.read decides who sees prices and totals in Procurement.
-- Depends on:  javaria_it_0021, javaria_it_0022 (run those first), javaria_it_0012/0013/0015/0017/
--              0020, talha_it_0003/0004/0005.
-- Applied to live DB: YES — the first draft (2026-11-06); this final version is reached through 0024
--
-- NOTE 2026-11-06: an earlier draft of this file WAS run on the live database. Don't run this file
-- there; run javaria_it_0024_repairs_in_procurement.sql, which brings it to this design.
--
-- How a repair fits the demand flow without changing it
--   * it.demands.product_id stays required: a repair demand points at a hidden service product
--     (products.service_category), so names, notifications and reports keep working. The hidden
--     products are inactive and left out of every product list.
--   * "Device back" (it.record_device_back) writes a normal receiving row, so invoices, approvals,
--     Finance and closing the demand run unchanged. A repair needs no gate pass.
--   * A demand is a repair demand when asset_id is set. Old demands in category Repair /
--     Maintenance / Fix have no asset and keep the delivery flow they started with.
--
-- Rollout notes
--   * Nobody loses access: it.assets.read_all goes to every role holding it.assets.read or
--     it.stock.read, and it.amounts.read to every role that processes, approves or pays. Take them
--     off a role on IT Roles & Permissions to narrow it. Which roles may see amounts is still to be
--     confirmed with Finance.
--   * Repairs open before this migration have no demand; they are closed on the asset page with
--     it.close_maintenance as before.
--
-- Functions REPLACED: it.demands_before_insert, it.receiving_has_gate_proof, it.receiving_stock_in.
-- Policies REPLACED: assets, asset_maintenance and stock_movements select.

begin;

-- ===========================================================================
-- PART A — Permissions.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.assets.read_all', 'it', 'See All Sites'' Assets & Stock',
   'See assets, repairs and stock of every site. Without it: only the sites the person is IT staff on'),
  ('it.amounts.read', 'it', 'See Prices & Totals',
   'See prices, estimated totals and invoice amounts in Procurement')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, np.id, null::uuid
from role_permissions rp
join permissions p on p.id = rp.permission_id
join permissions np on np.key = 'it.assets.read_all'
where p.key in ('it.assets.read', 'it.stock.read')
on conflict do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, np.id, null::uuid
from role_permissions rp
join permissions p on p.id = rp.permission_id
join permissions np on np.key = 'it.amounts.read'
where p.key in ('it.demands.update', 'it.demands.approve', 'it.demands.read_all',
                'it.invoices.approve', 'it.payments.update')
on conflict do nothing;

-- ===========================================================================
-- PART B — Site scoping (guide: "site staff see only their own site's assets and stock").
-- ===========================================================================

create function it.can_see_site_inventory(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- An asset with no site belongs to no site team, so it stays visible to every viewer.
  select has_permission('it.assets.read_all') or p_site_id is null or it.is_site_member(p_site_id);
$$;

revoke all on function it.can_see_site_inventory(uuid) from public;
grant execute on function it.can_see_site_inventory(uuid) to authenticated;

drop policy "assets readable by asset viewers" on it.assets;
create policy "assets readable by asset viewers" on it.assets
  for select to authenticated
  using (public.has_permission('it.assets.read') and it.can_see_site_inventory(site_id));

drop policy "maintenance readable by asset viewers" on it.asset_maintenance;
create policy "maintenance readable by asset viewers" on it.asset_maintenance
  for select to authenticated
  using ((public.has_permission('it.assets.read') or public.has_permission('it.maintenance.update'))
         and it.can_see_site_inventory(site_id));

drop policy "stock movements readable by stock viewers" on it.stock_movements;
create policy "stock movements readable by stock viewers" on it.stock_movements
  for select to authenticated
  using (has_permission('it.stock.read') and it.can_see_site_inventory(site_id));

-- ===========================================================================
-- PART C — Asset tags: AST- plus six digits (AST-00004 → AST-000004). Applied by trigger, so hand
-- entry and "Register assets" both end up the same. Other tag formats are left as typed.
-- ===========================================================================

create function it.normalize_asset_tag(p_tag text)
returns text
language sql
immutable
as $$
  select case
    when p_tag ~* '^\s*AST[-\s]?\d{1,6}\s*$'
      then 'AST-' || lpad(substring(p_tag from '\d+'), 6, '0')
    else p_tag
  end;
$$;

create function it.assets_normalize_tag()
returns trigger
language plpgsql
as $$
begin
  new.asset_tag := it.normalize_asset_tag(new.asset_tag);
  return new;
end;
$$;

create trigger trg_assets_normalize_tag
  before insert or update of asset_tag on it.assets
  for each row execute function it.assets_normalize_tag();

-- Existing tags; one that would clash with another asset is left for a person to sort out.
update it.assets a
   set asset_tag = it.normalize_asset_tag(a.asset_tag)
 where it.normalize_asset_tag(a.asset_tag) <> a.asset_tag
   and not exists (
     select 1 from it.assets o
     where o.id <> a.id
       and lower(it.normalize_asset_tag(o.asset_tag)) = lower(it.normalize_asset_tag(a.asset_tag)));

-- ===========================================================================
-- PART D — Links between demands, repairs, assets and tickets.
-- ===========================================================================

-- Hidden service products: see the note at the top.
alter table it.products
  add column service_category text unique check (service_category in ('Repair', 'Maintenance', 'Fix'));

insert into it.products (product_name, category, unit, is_active, service_category) values
  ('Repair service', 'Service', 'Each', false, 'Repair'),
  ('Maintenance service', 'Service', 'Each', false, 'Maintenance'),
  ('Fix service', 'Service', 'Each', false, 'Fix');

alter table it.demands
  add column asset_id uuid references it.assets(id),          -- the device a repair demand is for
  add column issue_type text,                                 -- what's wrong with it
  add column replaces_asset_id uuid references it.assets(id), -- Replace device
  add column ticket_id uuid references it.tickets(id);

create index demands_asset_idx on it.demands (asset_id) where asset_id is not null;
create index demands_replaces_asset_idx on it.demands (replaces_asset_id) where replaces_asset_id is not null;
create index demands_ticket_idx on it.demands (ticket_id) where ticket_id is not null;

alter table it.asset_maintenance
  add column kind text not null default 'Repair' check (kind in ('Repair', 'Service')),
  add column ticket_id uuid references it.tickets(id),
  add column demand_id uuid references it.demands(id),
  add constraint asset_maintenance_vendor_fk foreign key (vendor_id) references it.vendors(id);

create index asset_maintenance_demand_idx on it.asset_maintenance (demand_id);
create index asset_maintenance_ticket_idx on it.asset_maintenance (ticket_id);

-- A spare part on order for a repair.
alter table it.demands add column maintenance_id uuid references it.asset_maintenance(id);
create index demands_maintenance_idx on it.demands (maintenance_id) where maintenance_id is not null;

-- Parts used in a repair: the ledger row says which repair it went into.
alter table it.stock_movements add column maintenance_id uuid references it.asset_maintenance(id);
create index stock_movements_maintenance_idx on it.stock_movements (maintenance_id)
  where maintenance_id is not null;

-- ===========================================================================
-- PART E — Ticket helpers.
-- ===========================================================================

create function it.ticket_note(p_ticket_id uuid, p_body text)
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
create function it.resolve_ticket_from_asset(p_ticket_id uuid, p_notes text)
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
-- PART F — Repair demands.
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
create function it.demands_guard_links()
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

create trigger trg_demands_guard_links
  before update on it.demands
  for each row execute function it.demands_guard_links();

-- The asset goes In Repair as soon as the demand exists, so nobody hands it out meanwhile.
create function it.open_demand_repair(p_demand it.demands)
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
create function it.finish_demand_repair(
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

create function it.demands_open_repair()
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

create trigger trg_demands_open_repair
  after insert on it.demands
  for each row execute function it.demands_open_repair();

-- Rejected or cancelled → the asset is released and the ticket goes back to being worked. A rejected
-- demand that is revised sends the asset back in.
create function it.demands_sync_repair()
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

create trigger trg_demands_sync_repair
  after update of status on it.demands
  for each row execute function it.demands_sync_repair();

-- Raise a repair demand, from the ticket's Send for repair or from Raise Demand.
create function it.raise_repair_demand(
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
create function it.record_device_back(
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
create function it.invoices_set_repair_cost()
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
-- PART G — Replace device.
-- ===========================================================================

-- Ticket → ready-made demand: General purchase, same site, quantity 1, linked to the old asset.
-- The normal approval flow takes over from here.
create function it.raise_replacement_demand(
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
create function it.retire_replaced_asset()
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

create trigger trg_retire_replaced_asset
  after insert on it.asset_assignments
  for each row execute function it.retire_replaced_asset();

-- ===========================================================================
-- PART H — Minimum stock per product per site. A site with no row of its own falls back to the
-- product's reorder_level.
-- ===========================================================================

create table it.stock_minimums (
  product_id uuid not null references it.products(id),
  site_id uuid not null references public.org_units(id),
  min_quantity int not null check (min_quantity >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.persons(id),
  primary key (product_id, site_id)
);

alter table it.stock_minimums enable row level security;

create policy "stock minimums readable by stock viewers" on it.stock_minimums
  for select to authenticated
  using (has_permission('it.stock.read') and it.can_see_site_inventory(site_id));

grant select on it.stock_minimums to authenticated;

-- p_min_quantity null removes the site's own minimum.
create function it.set_stock_minimum(p_product_id uuid, p_site_id uuid, p_min_quantity int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_person_id() is null
     or not (has_permission('it.inventory_settings.update') or has_permission('it.stock.update')) then
    raise exception 'You need permission to set minimum stock levels' using errcode = '42501';
  end if;
  if p_min_quantity is null then
    delete from it.stock_minimums where product_id = p_product_id and site_id = p_site_id;
    return;
  end if;
  if p_min_quantity < 0 then
    raise exception 'The minimum can''t be below 0';
  end if;
  if it.product_is_fixed_asset(p_product_id) then
    raise exception 'A fixed asset has no minimum stock level';
  end if;
  perform it.check_org_unit(p_site_id, 'Site', 'site');

  insert into it.stock_minimums (product_id, site_id, min_quantity, updated_by)
  values (p_product_id, p_site_id, p_min_quantity, current_person_id())
  on conflict (product_id, site_id) do update
    set min_quantity = excluded.min_quantity, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;

revoke all on function it.set_stock_minimum(uuid, uuid, int) from public;
grant execute on function it.set_stock_minimum(uuid, uuid, int) to authenticated;

commit;
