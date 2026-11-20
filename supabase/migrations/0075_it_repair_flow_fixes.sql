-- Replicated from supabase/it-migrations/javaria/javaria_it_0027_repair_flow_fixes.sql. Its own
-- header says "Applied to live DB: NO", but that's stale: confirmed live 2026-11-20 by a
-- read-only check (trg_invoices_set_repair_cost already fires on delete; it.demands_guard_links
-- already blocks a quantity change). Nothing re-run; this only gives the live state a linear
-- history, same as the rest of this batch.
--
-- Three fixes to the repair flow (2026-11-16): a repair demand's quantity can no longer change
-- (Revise & resubmit offered it, which could leave a demand waiting on a second Device back); the
-- bill's total is now counted only on the repair record current for the demand (previously counted
-- twice after a reject/revise/bill cycle); see the file's own header for the third fix.

begin;

-- ===========================================================================
-- 1. A repair is for one device.
-- ===========================================================================

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
  if old.asset_id is not null
     and (new.quantity is distinct from 1 or coalesce(new.approved_quantity, 1) <> 1) then
    raise exception 'A repair is always for one device; its quantity stays 1';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 2. The repair's cost: the demand's live invoices, on its current repair record only.
-- ===========================================================================

create or replace function it.invoices_set_repair_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update it.asset_maintenance m
     set cost = coalesce((
           select sum(i.invoice_amount) from it.invoices i
            where i.demand_id = new.demand_id and i.deleted_at is null), 0)
   where m.id = (
           select id from it.asset_maintenance
            where demand_id = new.demand_id
            order by created_at desc
            limit 1);
  return null;
end;
$$;

revoke all on function it.invoices_set_repair_cost() from public;

drop trigger if exists trg_invoices_set_repair_cost on it.invoices;
create trigger trg_invoices_set_repair_cost
  after insert or update of invoice_amount, deleted_at on it.invoices
  for each row execute function it.invoices_set_repair_cost();

-- ===========================================================================
-- 3. Replace device: once per device.
-- ===========================================================================

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
  v_earlier it.demands%rowtype;
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
  -- One replacement per device: one in progress, or one already delivered and closed.
  select * into v_earlier from it.demands
   where replaces_asset_id = v_asset.id and deleted_at is null
     and status not in ('Cancelled', 'Rejected')
   order by created_at desc
   limit 1;
  if found then
    if v_earlier.status = 'Closed' then
      raise exception '% was already replaced on demand %', v_asset.asset_tag, v_earlier.demand_number;
    end if;
    raise exception 'A replacement demand for this device is already open (%)', v_earlier.demand_number;
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

commit;
