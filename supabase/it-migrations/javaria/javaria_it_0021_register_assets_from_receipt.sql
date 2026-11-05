-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Receiving → assets (09 §2 "registerAssetsFromReceipt", 07 Phase 7). After a delivery of
--              a fixed-asset product is recorded, IT registers each accepted unit as an asset from the
--              demand page: only tag + serial are typed; product, type, vendor, site, company,
--              purchase date and the receipt link are filled in here. Each new asset also gets its
--              first valuation (it.asset_values, value type New) at the demand's agreed — or else
--              estimated — unit price, so depreciation starts from the delivery date. Done on
--              IT/javaria with Talha's agreement (2026-11-05).
-- Depends on:  talha_it_0003_assets.sql, talha_it_0007_asset_tag_manual.sql (it.assets),
--              talha_it_0006_asset_values.sql (it.asset_values, it.asset_value_types "New"),
--              javaria_it_0012/0013 (it.receiving_records, it.record_receiving),
--              javaria_it_0010 (it.demand_updates).
-- Applied to live DB: NO

-- Safe to undo:
--   drop function it.register_assets_from_receipt(uuid, uuid, jsonb);
--   alter table it.assets drop constraint assets_vendor_fk;
--   alter table it.assets drop constraint assets_receiving_fk;
--   drop index it.assets_receiving_idx;

begin;

-- 1. The placeholder columns from talha_it_0003 get their foreign keys (07 §2.1). Checked
--    2026-11-05: no asset has a vendor_id or receiving_id yet, so these validate instantly.
alter table it.assets
  add constraint assets_vendor_fk foreign key (vendor_id) references it.vendors (id);
alter table it.assets
  add constraint assets_receiving_fk foreign key (receiving_id) references it.receiving_records (id);
create index assets_receiving_idx on it.assets (receiving_id) where receiving_id is not null;

-- 2. Register assets from one receipt.
--    p_items: [{ "asset_tag": "...", "serial_number": "...", "manufacturer"?, "model_number"?,
--                "warranty_expiry"? (yyyy-mm-dd), "notes"? }, ...]
--    p_company_id: owning company; may be null when the receipt / demand already has one, or the
--    portal has exactly one active company.
create function it.register_assets_from_receipt(
  p_receiving_id uuid,
  p_company_id uuid,
  p_items jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_rec it.receiving_records%rowtype;
  v_demand it.demands%rowtype;
  v_product it.products%rowtype;
  v_class text;
  v_company uuid;
  v_done int;
  v_count int;
  v_item jsonb;
  v_tag text;
  v_serial text;
  v_tags text[] := '{}';
  v_serials text[] := '{}';
  v_asset_id uuid;
  v_price numeric(12, 2);
  v_new_type uuid;
begin
  if v_actor is null or not has_permission('it.assets.create') then
    raise exception 'You need permission to register assets';
  end if;

  select * into v_rec from it.receiving_records
   where id = p_receiving_id and deleted_at is null
   for update;
  if not found then
    raise exception 'Delivery not found';
  end if;
  select * into v_demand from it.demands where id = v_rec.demand_id;
  select * into v_product from it.products where id = v_demand.product_id;
  select classification into v_class from it.asset_types where id = v_product.asset_type_id;
  if v_product.asset_type_id is null or v_class is distinct from 'Fixed' then
    raise exception '% is not a fixed-asset product — its items are counted as stock, not registered one by one',
      v_product.product_name;
  end if;

  select count(*) into v_done from it.assets where receiving_id = p_receiving_id and deleted_at is null;
  v_count := coalesce(jsonb_array_length(p_items), 0);
  if v_count = 0 then
    raise exception 'Add at least one asset';
  end if;
  if v_count > v_rec.accepted_quantity - v_done then
    raise exception 'Only % accepted item(s) from % are still unregistered',
      greatest(v_rec.accepted_quantity - v_done, 0), v_rec.receiving_number;
  end if;

  v_company := coalesce(p_company_id, v_rec.company_id, v_demand.company_id);
  if v_company is null and (select count(*) from companies where is_active) = 1 then
    select id into v_company from companies where is_active;
  end if;
  if v_company is null then
    raise exception 'Choose the company that owns these assets';
  end if;

  v_price := coalesce(v_demand.agreed_unit_price, v_demand.estimated_unit_price);
  select id into v_new_type from it.asset_value_types where name = 'New';

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_tag := btrim(coalesce(v_item->>'asset_tag', ''));
    v_serial := btrim(coalesce(v_item->>'serial_number', ''));
    if v_tag = '' or v_serial = '' then
      raise exception 'Every asset needs an asset tag and a serial number';
    end if;
    if lower(v_tag) = any (v_tags) then
      raise exception 'Asset tag % is entered twice', v_tag;
    end if;
    if lower(v_serial) = any (v_serials) then
      raise exception 'Serial number % is entered twice', v_serial;
    end if;
    v_tags := v_tags || lower(v_tag);
    v_serials := v_serials || lower(v_serial);

    begin
      insert into it.assets (
        asset_tag, serial_number, asset_name, asset_type_id, manufacturer, model_number,
        company_id, site_id, purchase_date, vendor_id, receiving_id, status, condition,
        warranty_expiry, notes, created_by, updated_by)
      values (
        v_tag, v_serial, v_product.product_name, v_product.asset_type_id,
        nullif(btrim(v_item->>'manufacturer'), ''), nullif(btrim(v_item->>'model_number'), ''),
        v_company, v_rec.site_id, v_rec.received_date, v_rec.vendor_id, v_rec.id, 'Unassigned',
        case when v_rec.condition = 'Good' then 'New' else v_rec.condition end,
        nullif(v_item->>'warranty_expiry', '')::date, nullif(btrim(v_item->>'notes'), ''),
        v_actor, v_actor)
      returning id into v_asset_id;
    exception when unique_violation then
      raise exception 'Asset tag % or serial number % is already used by another asset', v_tag, v_serial;
    end;

    -- First valuation: bought new at the demand's price; depreciation runs from the delivery date.
    if v_price is not null and v_new_type is not null then
      insert into it.asset_values (
        asset_id, value_type_id, purchase_value, current_value, accumulated_depreciation,
        valuation_date, remarks, created_by, updated_by)
      values (
        v_asset_id, v_new_type, v_price, v_price, 0, v_rec.received_date,
        'From ' || v_rec.receiving_number || ' at the demand price', v_actor, v_actor);
    end if;
  end loop;

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (v_demand.id, v_actor, 'system',
          format('%s asset(s) registered from %s: %s', v_count, v_rec.receiving_number,
                 (select string_agg(asset_tag, ', ' order by asset_tag) from it.assets
                   where receiving_id = p_receiving_id and deleted_at is null)));

  return v_count;
end;
$$;

revoke all on function it.register_assets_from_receipt(uuid, uuid, jsonb) from public;
grant execute on function it.register_assets_from_receipt(uuid, uuid, jsonb) to authenticated;

commit;
