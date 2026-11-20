-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Consumable stock (07 Phase 5, INV-07; 09 §2 "recordStockMovement"). Done on IT/javaria
--              with Talha's agreement (2026-11-05).
--              * it.stock_movements: append-only ledger per product per site (signed quantity).
--              * it.stock_levels: on-hand per product per site (view over the ledger).
--              * it.record_stock_movement(): opening balance, stock in, issue, adjustment — never below 0.
--              * Receiving a consumable product adds the accepted quantity to stock automatically.
--              * it.issue_demand_from_stock(): the consumable demand path takes the items out of stock
--                (replaces the "Stock Updated" note-only interim).
--              * products.reorder_level for the low-stock warning.
--              A product is a FIXED ASSET only when its asset type is classified Fixed; everything
--              else (no asset type, or a Consumable type such as Toner / Cable) is counted as stock.
-- Depends on:  talha_it_0002 (it.asset_types, it.stock.read / it.stock.update permissions + grants),
--              javaria_it_0009 (it.products), javaria_it_0010/0011/0013 (it.demands, can_process_demand,
--              check_org_unit, demands triggers), javaria_it_0012/0013 (it.receiving_records).
-- Applied to live DB: YES (by 2026-11-06, by Javaria, via Supabase SQL Editor)

-- Safe to undo:
--   drop trigger trg_receiving_stock_in on it.receiving_records;
--   drop function it.receiving_stock_in();
--   drop function it.issue_demand_from_stock(uuid, text);
--   drop function it.record_stock_movement(uuid, uuid, text, int, uuid, text, date);
--   drop function it.write_stock_movement(uuid, uuid, text, int, date, uuid, uuid, uuid, text);
--   drop function it.stock_on_hand(uuid, uuid);
--   drop view it.stock_levels;
--   drop table it.stock_movements;
--   drop function it.product_is_fixed_asset(uuid);
--   alter table it.products drop column reorder_level;

begin;

-- 1. Low-stock threshold per product (null = no warning).
alter table it.products
  add column reorder_level int check (reorder_level is null or reorder_level >= 0);

-- 2. Fixed asset = asset type classified Fixed. Used by stock, receiving and the demand form.
create function it.product_is_fixed_asset(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.classification = 'Fixed'
       from it.products p join it.asset_types t on t.id = p.asset_type_id
      where p.id = p_product_id),
    false);
$$;

-- 3. The ledger. Quantity is signed: + comes in, - goes out. Rows are never updated or deleted;
--    a mistake is corrected with an Adjustment.
create table it.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references it.products(id),
  site_id uuid not null references public.org_units(id),
  company_id uuid references public.companies(id),
  movement_type text not null check (movement_type in ('Opening', 'Received', 'Issued', 'Adjustment')),
  quantity int not null check (quantity <> 0),
  movement_date date not null default current_date,
  receiving_id uuid references it.receiving_records(id),
  demand_id uuid references it.demands(id),
  issued_to_person_id uuid references public.persons(id),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  constraint stock_movements_sign check (
    (movement_type in ('Opening', 'Received') and quantity > 0)
    or (movement_type = 'Issued' and quantity < 0)
    or movement_type = 'Adjustment')
);

create index stock_movements_product_site_idx on it.stock_movements (product_id, site_id, created_at);
create index stock_movements_date_idx on it.stock_movements (movement_date desc, created_at desc);
-- A delivery goes into stock once; a demand is issued once.
create unique index stock_movements_one_per_receipt on it.stock_movements (receiving_id)
  where receiving_id is not null;
create unique index stock_movements_one_issue_per_demand on it.stock_movements (demand_id)
  where demand_id is not null and movement_type = 'Issued';

alter table it.stock_movements enable row level security;

create policy "stock movements readable by stock viewers"
  on it.stock_movements for select to authenticated
  using (has_permission('it.stock.read'));
-- No insert / update / delete policies: rows are written only by the functions below.

grant select on it.stock_movements to authenticated;
grant select, insert on it.stock_movements to service_role;

-- 4. On hand per product per site (RLS of the ledger applies: security_invoker).
create view it.stock_levels
with (security_invoker = true) as
  select product_id, site_id, sum(quantity)::int as on_hand, max(created_at) as last_movement_at
    from it.stock_movements
   group by product_id, site_id;

grant select on it.stock_levels to authenticated;

create function it.stock_on_hand(p_product_id uuid, p_site_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::int from it.stock_movements
   where product_id = p_product_id and site_id = p_site_id;
$$;

-- 5. Internal writer: checks the product is stock-counted and the balance never goes below 0.
--    Serialised per product + site with an advisory lock so two issues can't both pass the check.
create function it.write_stock_movement(
  p_product_id uuid,
  p_site_id uuid,
  p_type text,
  p_change int,
  p_date date,
  p_receiving_id uuid,
  p_demand_id uuid,
  p_issued_to uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_name text;
  v_on_hand int;
  v_id uuid;
begin
  select product_name into v_name from it.products where id = p_product_id;
  if v_name is null then
    raise exception 'Product not found';
  end if;
  if it.product_is_fixed_asset(p_product_id) then
    raise exception '% is a fixed asset — it is registered in the Asset Register, not counted as stock', v_name;
  end if;
  perform it.check_org_unit(p_site_id, 'Site', 'site');
  if p_date is not null and p_date > current_date then
    raise exception 'The date can''t be in the future';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_product_id::text || ':' || p_site_id::text, 0));
  v_on_hand := it.stock_on_hand(p_product_id, p_site_id);
  if v_on_hand + p_change < 0 then
    raise exception 'Only % of % in stock at this site', v_on_hand, v_name;
  end if;

  insert into it.stock_movements (
    product_id, site_id, company_id, movement_type, quantity, movement_date,
    receiving_id, demand_id, issued_to_person_id, reason, created_by)
  values (
    p_product_id, p_site_id, (select company_id from persons where id = coalesce(p_issued_to, v_actor)),
    p_type, p_change, coalesce(p_date, current_date),
    p_receiving_id, p_demand_id, p_issued_to, nullif(btrim(p_reason), ''), v_actor)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function it.write_stock_movement(uuid, uuid, text, int, date, uuid, uuid, uuid, text) from public;

-- 6. Stock screen (INV-07): opening balance, stock in, issue to someone, adjustment.
--    p_quantity is always positive except for Adjustment, where the sign is the direction.
create function it.record_stock_movement(
  p_product_id uuid,
  p_site_id uuid,
  p_type text,
  p_quantity int,
  p_issued_to uuid,
  p_reason text,
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_person_id() is null or not has_permission('it.stock.update') then
    raise exception 'You need permission to record stock movements';
  end if;
  if p_type not in ('Opening', 'Received', 'Issued', 'Adjustment') then
    raise exception 'Choose stock in, issue or adjustment';
  end if;
  if p_quantity is null or p_quantity = 0 or (p_type <> 'Adjustment' and p_quantity < 0) then
    raise exception 'Enter a quantity greater than 0';
  end if;
  if p_type = 'Issued' and p_issued_to is null and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say who the items were issued to, or why';
  end if;
  if p_type = 'Adjustment' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'An adjustment needs a reason (count correction, damaged, expired …)';
  end if;

  return it.write_stock_movement(
    p_product_id, p_site_id, p_type,
    case when p_type = 'Issued' then -p_quantity else p_quantity end,
    p_date, null, null, p_issued_to, p_reason);
end;
$$;

revoke all on function it.record_stock_movement(uuid, uuid, text, int, uuid, text, date) from public;
grant execute on function it.record_stock_movement(uuid, uuid, text, int, uuid, text, date) to authenticated;

-- 7. Receiving a consumable product → stock in, automatically (09 §2 "receiving consumables").
create function it.receiving_stock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
begin
  if new.accepted_quantity <= 0 or new.site_id is null then
    return new;
  end if;
  select product_id into v_product from it.demands where id = new.demand_id;
  if v_product is null or it.product_is_fixed_asset(v_product) then
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

create trigger trg_receiving_stock_in
  after insert on it.receiving_records
  for each row execute function it.receiving_stock_in();

-- 8. Consumable demand path (BRD §5.5.3): Categorized → Stock Updated now takes the items out of
--    stock at the demand's site, issued to the requester. The status change itself still goes
--    through it.demands_before_update (who may do it, the note, the timeline, notifications).
create function it.issue_demand_from_stock(p_demand_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if current_person_id() is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can issue from stock';
  end if;
  if v_demand.status <> 'Categorized' or v_demand.demand_category is distinct from 'Consumable' then
    raise exception 'Only a categorised Consumable demand can be issued from stock';
  end if;

  perform it.write_stock_movement(
    v_demand.product_id, v_demand.site_id, 'Issued', -v_demand.quantity, current_date,
    null, v_demand.id, v_demand.requested_by_person_id, coalesce(nullif(btrim(p_note), ''), v_demand.demand_number));

  update it.demands
     set status = 'Stock Updated',
         stock_note = coalesce(nullif(btrim(p_note), ''), format('%s issued from stock', v_demand.quantity))
   where id = p_demand_id;
end;
$$;

revoke all on function it.issue_demand_from_stock(uuid, text) from public;
grant execute on function it.issue_demand_from_stock(uuid, text) to authenticated;

commit;
