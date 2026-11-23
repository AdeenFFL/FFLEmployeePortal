-- Replicated from supabase/it-migrations/talha/talha_it_0010_valuation_functions.sql (applied
-- live 2026-11-13, by Talha).
--
-- Phase 6 -- valuation and depreciation functions (book value from the New/Old asset_value_types
-- rules). See the staged file's header for the depreciation assumptions to confirm with finance.

begin;

-- ---------------------------------------------------------------------
-- compute_depreciation: pure calculation, changes nothing.
-- Any logged-in user may call it (it only reads the New/Old settings,
-- which every logged-in user can already read).
-- ---------------------------------------------------------------------
create or replace function it.compute_depreciation(
  p_purchase_value numeric,
  p_salvage_value  numeric,
  p_value_type_id  uuid,
  p_start_date     date,
  p_as_of          date default current_date
)
returns table (accumulated_depreciation numeric, current_value numeric)
language sql
stable
set search_path = ''
as $$
  with t as (
    select coalesce(
             nullif(v.useful_life_years, 0)::numeric,
             case when v.depreciation_percentage > 0 then 100 / v.depreciation_percentage end
           ) as life_years
      from it.asset_value_types v
     where v.id = p_value_type_id
  ),
  d as (
    select t.life_years,
           greatest(p_purchase_value - coalesce(p_salvage_value, 0), 0) as depreciable,
           greatest(
             (extract(year  from age(p_as_of, p_start_date)) * 12
              + extract(month from age(p_as_of, p_start_date)))::numeric,
             0) as months
      from t
  )
  select round(a.acc, 2),
         round(p_purchase_value - a.acc, 2)
    from (
      select least(d.depreciable, d.depreciable * d.months / (d.life_years * 12)) as acc
        from d
    ) a;
$$;

-- ---------------------------------------------------------------------
-- record_asset_valuation: works out the numbers and saves one valuation row.
-- The accumulated depreciation and current value are NEVER typed by hand.
-- ---------------------------------------------------------------------
create or replace function it.record_asset_valuation(
  p_asset_id       uuid,
  p_value_type_id  uuid,
  p_purchase_value numeric,
  p_salvage_value  numeric default 0,
  p_valuation_date date    default current_date,
  p_remarks        text    default null,
  p_start_date     date    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := public.current_person_id();
  v_salvage numeric := coalesce(p_salvage_value, 0);
  v_asset   record;
  v_type    record;
  v_start   date;
  v_acc     numeric;
  v_cur     numeric;
  v_id      uuid;
begin
  if v_me is null or not public.has_permission('it.valuation.update') then
    raise exception 'You are not allowed to record valuations.' using errcode = '42501';
  end if;

  if p_purchase_value is null or p_purchase_value < 0 then
    raise exception 'Purchase value must be 0 or more.';
  end if;

  if v_salvage < 0 or v_salvage > p_purchase_value then
    raise exception 'Salvage value must be between 0 and the purchase value.';
  end if;

  select a.id, a.purchase_date, a.deleted_at
    into v_asset
    from it.assets a
   where a.id = p_asset_id;

  if not found or v_asset.deleted_at is not null then
    raise exception 'Asset not found.';
  end if;

  select v.id, v.depreciation_method
    into v_type
    from it.asset_value_types v
   where v.id = p_value_type_id;

  if not found then
    raise exception 'Value type not found.';
  end if;

  if v_type.depreciation_method is distinct from 'Straight Line' then
    raise exception 'Only the Straight Line method is supported.';
  end if;

  v_start := coalesce(p_start_date, v_asset.purchase_date);
  if v_start is null then
    raise exception 'This asset has no purchase date. Set it on the asset, or enter a start date.';
  end if;

  if p_valuation_date < v_start then
    raise exception 'The valuation date cannot be before the start date (%).', v_start;
  end if;

  select c.accumulated_depreciation, c.current_value
    into v_acc, v_cur
    from it.compute_depreciation(p_purchase_value, v_salvage, p_value_type_id, v_start, p_valuation_date) c;

  if v_acc is null then
    raise exception 'This value type has no useful life or depreciation percentage.';
  end if;

  insert into it.asset_values
    (asset_id, value_type_id, purchase_value, current_value, accumulated_depreciation,
     salvage_value, valuation_date, remarks, created_by, updated_by)
  values
    (p_asset_id, p_value_type_id, p_purchase_value, v_cur, v_acc,
     v_salvage, p_valuation_date, p_remarks, v_me, v_me)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function it.compute_depreciation(numeric, numeric, uuid, date, date)                    from public, anon;
revoke all on function it.record_asset_valuation(uuid, uuid, numeric, numeric, date, text, date)      from public, anon;

grant execute on function it.compute_depreciation(numeric, numeric, uuid, date, date)                 to authenticated, service_role;
grant execute on function it.record_asset_valuation(uuid, uuid, numeric, numeric, date, text, date)   to authenticated, service_role;

commit;
