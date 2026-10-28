-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement — BRD alignment review (09-it-procurement-plan.md "BRD alignment
--              2026-10-28"; BRD §5.5.2, §5.5.4, §5.5.12, §5.5.14, §5.5.16, scope "audit log")
-- Depends on:  javaria_it_0010 … javaria_it_0016
-- Applied to live DB: NO
--
-- What this does (items 1–6 of the review)
--   1. Category chosen when raising (BRD §5.5.2 "the requester selects a category … mandatory"):
--      a new demand needs demand_category and starts as Categorized. Procurement can still change
--      it before approval. (Older Open demands keep the Categorise step.)
--   2. Automatic routing to the Department Head (§5.5.4): as soon as a demand is Categorized —
--      raised, re-categorised, revised after rejection — a non-consumable demand goes to Pending
--      Approval and the department's approvers are notified. Consumables (when the consumable path
--      is on) wait for "Issue from stock"; "Send for approval" stays for an out-of-stock
--      consumable or after adding a missing approver. No approver → stays Categorized with a note.
--   3. Automatic routing of verified invoices (§5.5.14): an invoice that verifies on logging, on
--      edit, or when its flag is cleared goes straight to Pending Approval.
--   4. Finance can log / edit invoices and upload invoice files too (§5.5.12 "by Finance or the
--      Site Support Team"): it.can_manage_invoices() includes it.is_finance().
--   5. GL / Cost Center (§5.5.16 package): invoices.cost_center (optional) and an "Approval"
--      document (cost-center head sign-off) on the invoice. The package view is a screen.
--   6. Audit log (scope "audit log of system actions"): every procurement timeline event except
--      comments / internal notes is mirrored into public.audit_log (module 'it'), so it shows on
--      Administration → Audit Log.
--   Also: demand_updates.created_at defaults to clock_timestamp() so several events written in
--   one transaction keep their order on the timeline.
--
-- Functions REPLACED: it.demands_before_insert, it.submit_demand_for_approval,
-- it.submit_invoice_for_approval, it.clear_invoice_flag, it.can_manage_invoices,
-- it.add_invoice_document. RE-SIGNED (+ p_cost_center): it.log_invoice, it.update_invoice.

-- ===========================================================================
-- PART A — Columns.
-- ===========================================================================

alter table it.demand_updates alter column created_at set default clock_timestamp();

alter table it.invoices add column cost_center text;

-- ===========================================================================
-- PART B — Demands: category at raise + automatic routing.
-- ===========================================================================

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
  new.site_id := coalesce(new.site_id, v_home_site, it.hq_site_id());
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

-- Internal: Categorized → Pending Approval + notify the approvers. Returns whether it routed.
-- p_force = true sends a consumable too (out of stock); otherwise consumables wait for stock.
create function it.route_demand_for_approval(p_demand_id uuid, p_force boolean default false)
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
      format('The %s department has no demand approver. Add one under Department Approvers, then use "Send for approval".',
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

revoke all on function it.route_demand_for_approval(uuid, boolean) from public;

-- Route automatically whenever a demand becomes (or is re-categorised while) Categorized.
create function it.route_demand_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Categorized'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'Categorized'
          or new.demand_category is distinct from old.demand_category) then
    perform it.route_demand_for_approval(new.id, false);
  end if;
  return null;
end;
$$;

revoke all on function it.route_demand_after_write() from public;

-- Named to sort after trg_log_demand_* / trg_notify_demand_* (same-timing triggers fire
-- alphabetically), so "raised" / the category change are on the timeline first.
create trigger trg_route_demand_after_insert
  after insert on it.demands
  for each row execute function it.route_demand_after_write();
create trigger trg_route_demand_after_update
  after update on it.demands
  for each row execute function it.route_demand_after_write();

-- Manual "Send for approval": an out-of-stock consumable, or after adding a missing approver.
create or replace function it.submit_demand_for_approval(p_demand_id uuid)
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
  if not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can send a demand for approval';
  end if;
  if v_demand.status <> 'Categorized' then
    raise exception 'Only a categorised demand can be sent for approval (it is %)', v_demand.status;
  end if;
  if not exists (select 1 from it.demand_approvers_for(v_demand.department_id)) then
    raise exception 'The % department has no demand approver yet — add one under Procurement → Department Approvers',
      (select name from org_units where id = v_demand.department_id);
  end if;
  perform it.route_demand_for_approval(p_demand_id, true);
end;
$$;

-- ===========================================================================
-- PART C — Invoices: Finance can manage, automatic routing, cost center, sign-off document.
-- ===========================================================================

create or replace function it.can_manage_invoices(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select (has_permission('it.invoices.update')
          and (has_permission('it.demands.read_all')
               or (p_site_id is not null and it.is_site_member(p_site_id))))
      or it.is_finance();
$$;

-- Internal: Verified → Pending Approval + notify the invoice approvers. Returns whether it routed.
create function it.route_invoice_for_approval(p_invoice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
  v_person uuid;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null;
  if not found or v_inv.status <> 'Verified' then
    return false;
  end if;
  select * into v_demand from it.demands where id = v_inv.demand_id;

  if not exists (select 1 from it.invoice_approvers_for(v_demand.department_id)) then
    perform it.invoice_event(v_inv,
      format('verified — waiting: the %s department has no invoice approver yet',
             (select name from org_units where id = v_demand.department_id)),
      true, format('Invoice %s can''t be routed for approval', v_inv.invoice_number));
    return false;
  end if;

  update it.invoices
     set status = 'Pending Approval', submitted_at = now(), revision_reason = null,
         updated_by = coalesce(current_person_id(), updated_by)
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv, 'sent to the department head for approval', false, null);

  for v_person in select person_id from it.invoice_approvers_for(v_demand.department_id) loop
    if v_person is distinct from v_inv.created_by then
      perform it.notify_demand_person(v_person, 'invoice_approval',
        format('Invoice approval needed: %s (demand %s)', v_inv.invoice_number, v_demand.demand_number),
        format('Rs %s from %s.', to_char(v_inv.invoice_amount, 'FM999,999,999,990.00'),
               coalesce((select vendor_name from it.vendors where id = v_inv.vendor_id), 'the vendor')),
        v_demand.id);
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function it.route_invoice_for_approval(uuid) from public;

-- Manual send (after adding a missing approver).
create or replace function it.submit_invoice_for_approval(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if current_person_id() is null or not it.can_manage_invoices(v_inv.site_id) then
    raise exception 'You need Manage Invoices for this site';
  end if;
  if v_inv.status <> 'Verified' then
    raise exception 'Only a verified invoice can be sent for approval (it is %)', v_inv.status;
  end if;
  select * into v_demand from it.demands where id = v_inv.demand_id;
  if not exists (select 1 from it.invoice_approvers_for(v_demand.department_id)) then
    raise exception 'The % department has no invoice approver — set one under Department Approvers',
      (select name from org_units where id = v_demand.department_id);
  end if;
  perform it.route_invoice_for_approval(p_invoice_id);
end;
$$;

drop function it.log_invoice(uuid, text, date, int, numeric, numeric, text);

create function it.log_invoice(
  p_receiving_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_quantity int,
  p_amount numeric,
  p_tax numeric,
  p_cost_center text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_rec it.receiving_records%rowtype;
  v_demand it.demands%rowtype;
  v_check record;
  v_inv it.invoices%rowtype;
begin
  select * into v_rec from it.receiving_records where id = p_receiving_id and deleted_at is null;
  if not found then
    raise exception 'Delivery not found';
  end if;
  select * into v_demand from it.demands where id = v_rec.demand_id for update;
  if v_actor is null or not it.can_manage_invoices(v_demand.site_id) then
    raise exception 'You need Manage Invoices (or Finance) for this site';
  end if;
  if v_demand.status in ('Closed', 'Cancelled') then
    raise exception 'This demand is %', lower(v_demand.status);
  end if;
  if v_rec.accepted_quantity = 0 then
    raise exception 'Nothing was accepted on delivery % — there is nothing to invoice', v_rec.receiving_number;
  end if;
  if exists (select 1 from it.invoices where receiving_id = p_receiving_id and deleted_at is null) then
    raise exception 'Delivery % already has an invoice — edit that one', v_rec.receiving_number;
  end if;
  if coalesce(trim(p_invoice_number), '') = '' then
    raise exception 'Enter the vendor''s invoice number';
  end if;
  if p_invoice_date is null or p_invoice_date > current_date then
    raise exception 'The invoice date can''t be in the future';
  end if;
  if p_quantity is null or p_quantity < 0 or p_amount is null or p_amount < 0
     or coalesce(p_tax, 0) < 0 or coalesce(p_tax, 0) > p_amount then
    raise exception 'Check the quantity, amount and tax';
  end if;

  select * into v_check from it.check_invoice(p_receiving_id, p_quantity, p_amount, coalesce(p_tax, 0));

  insert into it.invoices (
    receiving_id, demand_id, vendor_id, site_id, company_id, invoice_number, invoice_date,
    invoice_quantity, invoice_amount, tax_amount, cost_center, notes, status, expected_amount,
    quantity_mismatch, amount_mismatch, verification_notes, created_by, updated_by)
  values (
    p_receiving_id, v_demand.id, v_rec.vendor_id, v_demand.site_id, v_demand.company_id,
    trim(p_invoice_number), p_invoice_date, p_quantity, round(p_amount, 2), round(coalesce(p_tax, 0), 2),
    nullif(trim(p_cost_center), ''), nullif(trim(p_notes), ''),
    case when v_check.quantity_mismatch or v_check.amount_mismatch then 'Flagged' else 'Verified' end,
    v_check.expected_amount, v_check.quantity_mismatch, v_check.amount_mismatch, v_check.notes,
    v_actor, v_actor)
  returning * into v_inv;

  if v_demand.status = 'Received' then
    perform set_config('it.demand_system', 'on', true);
    update it.demands set status = 'Invoicing', updated_by = v_actor where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
  end if;

  perform it.invoice_event(v_inv,
    format('logged, Rs %s — %s', to_char(v_inv.invoice_amount, 'FM999,999,999,990.00'),
           case when v_inv.status = 'Flagged' then 'FLAGGED: ' || v_inv.verification_notes
                else 'matches the delivery' end),
    false, null);

  perform it.route_invoice_for_approval(v_inv.id); -- §5.5.14: verified → straight to approval
  return v_inv.id;
end;
$$;

drop function it.update_invoice(uuid, text, date, int, numeric, numeric, text);

create function it.update_invoice(
  p_invoice_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_quantity int,
  p_amount numeric,
  p_tax numeric,
  p_cost_center text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_check record;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.can_manage_invoices(v_inv.site_id) then
    raise exception 'You need Manage Invoices (or Finance) for this site';
  end if;
  if v_inv.status not in ('Logged', 'Verified', 'Flagged', 'Revise') then
    raise exception 'An invoice that is % can''t be edited', v_inv.status;
  end if;
  if coalesce(trim(p_invoice_number), '') = '' or p_invoice_date is null or p_invoice_date > current_date
     or p_quantity is null or p_quantity < 0 or p_amount is null or p_amount < 0
     or coalesce(p_tax, 0) < 0 or coalesce(p_tax, 0) > p_amount then
    raise exception 'Check the invoice number, date, quantity, amount and tax';
  end if;

  select * into v_check from it.check_invoice(v_inv.receiving_id, p_quantity, p_amount, coalesce(p_tax, 0));

  update it.invoices
     set invoice_number = trim(p_invoice_number),
         invoice_date = p_invoice_date,
         invoice_quantity = p_quantity,
         invoice_amount = round(p_amount, 2),
         tax_amount = round(coalesce(p_tax, 0), 2),
         cost_center = nullif(trim(p_cost_center), ''),
         notes = nullif(trim(p_notes), ''),
         expected_amount = v_check.expected_amount,
         quantity_mismatch = v_check.quantity_mismatch,
         amount_mismatch = v_check.amount_mismatch,
         verification_notes = v_check.notes,
         status = case when v_check.quantity_mismatch or v_check.amount_mismatch then 'Flagged' else 'Verified' end,
         flag_cleared_by = null, flag_cleared_at = null, flag_clear_note = null,
         updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv,
    'edited — ' || case when v_inv.status = 'Flagged' then 'FLAGGED: ' || v_inv.verification_notes
                        else 'now matches the delivery' end,
    false, null);

  perform it.route_invoice_for_approval(v_inv.id);
end;
$$;

create or replace function it.clear_invoice_flag(p_invoice_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.can_manage_invoices(v_inv.site_id) then
    raise exception 'You need Manage Invoices (or Finance) for this site';
  end if;
  if v_inv.status <> 'Flagged' then
    raise exception 'Only a flagged invoice can be cleared';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Please explain why the difference is acceptable';
  end if;

  update it.invoices
     set status = 'Verified', flag_cleared_by = v_actor, flag_cleared_at = now(),
         flag_clear_note = trim(p_note), updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv, 'mismatch cleared — ' || trim(p_note), false, null);
  perform it.route_invoice_for_approval(v_inv.id);
end;
$$;

-- + 'Approval' (GL / cost-center head sign-off, §5.5.16).
create or replace function it.add_invoice_document(
  p_invoice_id uuid,
  p_doc_type text,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_id uuid;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.can_manage_invoices(v_inv.site_id) then
    raise exception 'You need Manage Invoices (or Finance) for this site';
  end if;
  if v_inv.status in ('Sent to Finance', 'Confirmed', 'Paid') and not it.is_finance() then
    raise exception 'The package has gone to Finance — ask Finance to attach further documents';
  end if;
  if p_doc_type not in ('Invoice', 'Approval', 'Other') then
    raise exception 'Invalid document type';
  end if;
  if split_part(p_storage_path, '/', 1) <> v_inv.demand_id::text then
    raise exception 'Invalid file path';
  end if;

  insert into it.documents (entity_type, entity_id, demand_id, doc_type, storage_path, file_name,
                            content_type, size_bytes, uploaded_by)
  values ('invoice', p_invoice_id, v_inv.demand_id, p_doc_type, p_storage_path, left(p_file_name, 200),
          p_content_type, p_size_bytes, v_actor)
  returning id into v_id;

  perform it.invoice_event(v_inv,
    format('%s file added: %s', case when p_doc_type = 'Approval' then 'Cost center sign-off' else p_doc_type end,
           left(p_file_name, 200)),
    false, null);
  return v_id;
end;
$$;

revoke all on function it.log_invoice(uuid, text, date, int, numeric, numeric, text, text) from public;
revoke all on function it.update_invoice(uuid, text, date, int, numeric, numeric, text, text) from public;
grant execute on function it.log_invoice(uuid, text, date, int, numeric, numeric, text, text) to authenticated;
grant execute on function it.update_invoice(uuid, text, date, int, numeric, numeric, text, text) to authenticated;

-- ===========================================================================
-- PART D — Audit log: mirror procurement timeline events into public.audit_log.
-- ===========================================================================

create function it.audit_demand_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := new.author_person_id;
begin
  if new.update_type in ('comment', 'work_note') then
    return null;
  end if;
  insert into audit_log (actor_id, actor_label, module, action, details)
  values (
    v_actor,
    coalesce((select full_name from persons where id = v_actor), 'System'),
    'it',
    case when new.update_type = 'created' then 'CREATED' else 'MODIFIED' end,
    format('Procurement %s: %s',
           (select demand_number from it.demands where id = new.demand_id), left(new.body, 900)));
  return null;
end;
$$;

revoke all on function it.audit_demand_update() from public;

create trigger trg_audit_demand_update
  after insert on it.demand_updates
  for each row execute function it.audit_demand_update();
