-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement — Raise Demand works again after HQ-site routing was removed
--              (09-it-procurement-plan.md "Follow-up 2026-11-03")
-- Depends on:  javaria_it_0017_procurement_brd_alignment.sql; it/adeen
--              supabase/migrations/0053_it_remove_hq_site_routing.sql (already run on the live DB)
-- Applied to live DB: NO
--
-- 0053 dropped it.hq_site_id() and it.settings. it.demands_before_insert (javaria_it_0017) still
-- fell back to it.hq_site_id() when no site was given, so every new demand failed with
-- "function it.hq_site_id() does not exist". The form always sends a site; the fallback is now
-- just the requester's own site, otherwise "Please choose the site".
--
-- Function REPLACED: it.demands_before_insert (only the site_id line differs from 0017).

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

  select is_active, coalesce(current_price, purchase_price) into v_active, v_price
  from it.products where id = new.product_id;
  if not coalesce(v_active, false) then
    raise exception 'Please choose an active product from the Product Master';
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
