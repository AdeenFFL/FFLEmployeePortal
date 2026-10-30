-- Employee Portal — IT module: Procurement Phase 5: invoices.
-- Replicated into the main sequence from supabase/it-migrations/javaria/javaria_it_0014_invoices.sql
-- (Javaria, IT/javaria) — already recorded there as applied to the live DB; nothing
-- re-run here, this only gives the already-live state a linear, portal-wide history.
--
-- Decisions (2026-10-23, Javaria)
--   * ONE invoice per delivery (ERD invoices.receiving_id). A delivery has at most one live
--     invoice; "Revise" edits the same invoice.
--   * Automatic check (§5.5.13): invoice quantity must equal the delivery's ACCEPTED quantity;
--     invoice amount before tax must be within the tolerance (procurement settings,
--     invoice_tolerance_pct) of accepted × agreed unit price. A mismatch → Flagged with the
--     reasons; it can't go for approval until someone with Manage Invoices clears it with a note.
--   * Gate pass rule (decided in Phase 4): an invoice can't be sent to Finance until its delivery
--     has a gate pass number OR picture (it.receiving_has_gate_proof). The invoice file itself
--     must be uploaded too (the Finance package, §5.5.16).
--   * Approver = it.invoices.approve AND a can_approve_invoices row for the demand's department
--     (it.department_approvers). The person who logged an invoice can't approve it.
--
-- Status: Logged → Verified | Flagged → (flag cleared) Verified → Pending Approval →
--         Approved | Revise (→ edited → Verified | Flagged …) → Sent to Finance
--         → Confirmed → Paid (Phase 6)
-- Demand: Received + an invoice logged → Invoicing (closing is Phase 6).

-- ===========================================================================
-- PART A — Table.
-- ===========================================================================

create table it.invoices (
  id uuid primary key default gen_random_uuid(),
  receiving_id uuid not null references it.receiving_records(id),
  demand_id uuid not null references it.demands(id),
  vendor_id uuid references it.vendors(id),
  site_id uuid references public.org_units(id),
  company_id uuid references public.companies(id),

  invoice_number text not null check (length(trim(invoice_number)) > 0), -- the vendor's number
  invoice_date date not null,
  invoice_quantity int not null check (invoice_quantity >= 0),
  invoice_amount numeric(12, 2) not null check (invoice_amount >= 0), -- total payable incl. tax
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0 and tax_amount <= invoice_amount),
  notes text,

  status text not null default 'Logged' check (status in (
    'Logged', 'Verified', 'Flagged', 'Pending Approval', 'Approved', 'Revise',
    'Sent to Finance', 'Confirmed', 'Paid'
  )),

  -- Verification (§5.5.13), recomputed on every edit.
  expected_amount numeric(12, 2),
  quantity_mismatch boolean not null default false,
  amount_mismatch boolean not null default false,
  verification_notes text,
  flag_cleared_by uuid references public.persons(id),
  flag_cleared_at timestamptz,
  flag_clear_note text,

  -- Approval (#2) and hand-over.
  submitted_at timestamptz,
  approved_by uuid references public.persons(id),
  approved_at timestamptz,
  approval_comments text,
  revision_reason text,
  sent_to_finance_at timestamptz,
  sent_to_finance_by uuid references public.persons(id),

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create unique index invoices_one_per_delivery on it.invoices (receiving_id) where deleted_at is null;
create unique index invoices_vendor_number_unique
  on it.invoices (vendor_id, lower(trim(invoice_number))) where deleted_at is null;
create index invoices_demand_idx on it.invoices (demand_id);
create index invoices_status_idx on it.invoices (status);

create trigger invoices_set_updated_at
  before update on it.invoices
  for each row execute function public.set_updated_at();

alter table it.notifications add column invoice_id uuid references it.invoices(id) on delete cascade;

-- ===========================================================================
-- PART B — Helpers.
-- ===========================================================================

-- Log / edit / clear / send invoices for a site's demands.
create function it.can_manage_invoices(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.invoices.update')
     and (has_permission('it.demands.read_all')
          or (p_site_id is not null and it.is_site_member(p_site_id)));
$$;

create function it.is_invoice_approver(p_department_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.invoices.approve')
     and exists (
       select 1 from it.department_approvers a
       where a.department_id = p_department_id
         and a.person_id = current_person_id()
         and a.can_approve_invoices
     );
$$;

create function it.my_invoice_approver_departments()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select a.department_id from it.department_approvers a
  where a.person_id = current_person_id() and a.can_approve_invoices
    and has_permission('it.invoices.approve');
$$;

create function it.invoice_approvers_for(p_department_id uuid)
returns table (person_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select distinct a.person_id
  from it.department_approvers a
  join user_roles ur on ur.person_id = a.person_id
  join role_permissions rp on rp.role_id = ur.role_id
  join permissions perm on perm.id = rp.permission_id and perm.key = 'it.invoices.approve'
  where a.department_id = p_department_id and a.can_approve_invoices;
$$;

-- Approvers see the masters too (product / vendor names on what they approve).
create or replace function it.can_read_procurement_masters()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.vendors.update')
      or has_permission('it.products.update')
      or has_permission('it.procurement_settings.update')
      or has_permission('it.demands.create')
      or has_permission('it.demands.read')
      or has_permission('it.demands.read_all')
      or has_permission('it.demands.update')
      or has_permission('it.demands.approve')
      or has_permission('it.invoices.update')
      or has_permission('it.invoices.approve')
      or has_permission('it.payments.update')
      or has_permission('it.assets.read');
$$;

-- Sets expected_amount, mismatch flags, notes and Verified / Flagged on the given row values.
-- Used by the log / edit functions before they write.
create function it.check_invoice(
  p_receiving_id uuid,
  p_quantity int,
  p_amount numeric,
  p_tax numeric,
  out expected_amount numeric,
  out quantity_mismatch boolean,
  out amount_mismatch boolean,
  out notes text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_accepted int;
  v_price numeric(12, 2);
  v_tol numeric;
  v_net numeric;
  v_reasons text[] := '{}';
begin
  select r.accepted_quantity, coalesce(d.agreed_unit_price, d.estimated_unit_price)
    into v_accepted, v_price
  from it.receiving_records r join it.demands d on d.id = r.demand_id
  where r.id = p_receiving_id;

  select coalesce(invoice_tolerance_pct, 0) into v_tol from it.procurement_settings where id;
  v_net := coalesce(p_amount, 0) - coalesce(p_tax, 0);

  quantity_mismatch := p_quantity is distinct from v_accepted;
  if quantity_mismatch then
    v_reasons := v_reasons || format('Quantity %s billed but %s accepted on the delivery', p_quantity, v_accepted);
  end if;

  if v_price is null then
    expected_amount := null;
    amount_mismatch := true;
    v_reasons := v_reasons || 'No agreed price on the demand to check against'::text;
  else
    expected_amount := round(v_accepted * v_price, 2);
    amount_mismatch := abs(v_net - expected_amount) > greatest(round(expected_amount * coalesce(v_tol, 0) / 100, 2), 0.01);
    if amount_mismatch then
      v_reasons := v_reasons || format('Amount before tax Rs %s vs expected Rs %s (%s × Rs %s, tolerance %s%%)',
        to_char(v_net, 'FM999,999,999,990.00'), to_char(expected_amount, 'FM999,999,999,990.00'),
        v_accepted, to_char(v_price, 'FM999,999,999,990.00'), v_tol);
    end if;
  end if;

  notes := nullif(array_to_string(v_reasons, '; '), '');
end;
$$;

revoke all on function it.can_manage_invoices(uuid) from public;
revoke all on function it.is_invoice_approver(uuid) from public;
revoke all on function it.my_invoice_approver_departments() from public;
revoke all on function it.invoice_approvers_for(uuid) from public;
revoke all on function it.check_invoice(uuid, int, numeric, numeric) from public;
grant execute on function it.can_manage_invoices(uuid) to authenticated;
grant execute on function it.is_invoice_approver(uuid) to authenticated;
grant execute on function it.my_invoice_approver_departments() to authenticated;

-- Timeline + notification for an invoice event (internal).
create function it.invoice_event(
  p_invoice it.invoices,
  p_body text,
  p_notify_processors boolean,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text := (select receiving_number from it.receiving_records where id = p_invoice.receiving_id);
begin
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_invoice.demand_id, current_person_id(), 'system',
          format('Invoice %s (delivery %s): %s', p_invoice.invoice_number, v_number, p_body));
  if p_notify_processors then
    perform it.notify_demand_processors(p_invoice.site_id, 'invoice_update',
      coalesce(p_title, format('Invoice %s: %s', p_invoice.invoice_number, p_invoice.status)),
      p_body, p_invoice.demand_id);
  end if;
end;
$$;

revoke all on function it.invoice_event(it.invoices, text, boolean, text) from public;

-- ===========================================================================
-- PART C — Workflow functions.
-- ===========================================================================

create function it.log_invoice(
  p_receiving_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_quantity int,
  p_amount numeric,
  p_tax numeric,
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
    raise exception 'You need Manage Invoices for this site';
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
    invoice_quantity, invoice_amount, tax_amount, notes, status, expected_amount,
    quantity_mismatch, amount_mismatch, verification_notes, created_by, updated_by)
  values (
    p_receiving_id, v_demand.id, v_rec.vendor_id, v_demand.site_id, v_demand.company_id,
    trim(p_invoice_number), p_invoice_date, p_quantity, round(p_amount, 2), round(coalesce(p_tax, 0), 2),
    nullif(trim(p_notes), ''),
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
  return v_inv.id;
end;
$$;

-- Edit while Logged / Verified / Flagged / Revise; re-checked every time.
create function it.update_invoice(
  p_invoice_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_quantity int,
  p_amount numeric,
  p_tax numeric,
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
    raise exception 'You need Manage Invoices for this site';
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
end;
$$;

-- A verifier accepts a mismatch with a reason (e.g. freight agreed by phone).
create function it.clear_invoice_flag(p_invoice_id uuid, p_note text)
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
    raise exception 'You need Manage Invoices for this site';
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
end;
$$;

-- §5.5.14: Verified → Pending Approval, notify the department's invoice approvers.
create function it.submit_invoice_for_approval(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
  v_person uuid;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.can_manage_invoices(v_inv.site_id) then
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

  update it.invoices
     set status = 'Pending Approval', submitted_at = now(), revision_reason = null, updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv, 'sent for approval', false, null);

  for v_person in select person_id from it.invoice_approvers_for(v_demand.department_id) loop
    if v_person is distinct from v_inv.created_by then
      perform it.notify_demand_person(v_person, 'invoice_approval',
        format('Invoice approval needed: %s (demand %s)', v_inv.invoice_number, v_demand.demand_number),
        format('Rs %s from %s.', to_char(v_inv.invoice_amount, 'FM999,999,999,990.00'),
               coalesce((select vendor_name from it.vendors where id = v_inv.vendor_id), 'the vendor')),
        v_demand.id);
    end if;
  end loop;
end;
$$;

-- §5.5.15: approve, or send back for revision with the reason logged.
create function it.decide_invoice(p_invoice_id uuid, p_decision text, p_comments text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
  v_comments text := nullif(trim(coalesce(p_comments, '')), '');
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  select * into v_demand from it.demands where id = v_inv.demand_id;
  if v_actor is null or not it.is_invoice_approver(v_demand.department_id) then
    raise exception 'You are not an invoice approver for this department';
  end if;
  if v_actor = v_inv.created_by then
    raise exception 'You logged this invoice, so another approver has to decide it';
  end if;
  if v_inv.status <> 'Pending Approval' then
    raise exception 'This invoice is not awaiting approval (it is %)', v_inv.status;
  end if;

  if p_decision = 'Approved' then
    update it.invoices
       set status = 'Approved', approved_by = v_actor, approved_at = now(),
           approval_comments = v_comments, updated_by = v_actor
     where id = p_invoice_id
    returning * into v_inv;
    perform it.invoice_event(v_inv, 'approved' || coalesce(' — ' || v_comments, ''), true,
      format('Invoice %s approved — send it to Finance', v_inv.invoice_number));
  elsif p_decision = 'Revise' then
    if v_comments is null then
      raise exception 'Please say what needs to be revised';
    end if;
    update it.invoices
       set status = 'Revise', revision_reason = v_comments, approval_comments = v_comments, updated_by = v_actor
     where id = p_invoice_id
    returning * into v_inv;
    perform it.invoice_event(v_inv, 'sent back for revision — ' || v_comments, true,
      format('Invoice %s needs revision', v_inv.invoice_number));
  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end;
$$;

-- §5.5.16: Approved → Sent to Finance. Needs the gate-pass proof and the invoice file.
create function it.send_invoice_to_finance(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_inv it.invoices%rowtype;
  v_demand it.demands%rowtype;
  v_person uuid;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.can_manage_invoices(v_inv.site_id) then
    raise exception 'You need Manage Invoices for this site';
  end if;
  if v_inv.status <> 'Approved' then
    raise exception 'Only an approved invoice can go to Finance (it is %)', v_inv.status;
  end if;
  if not it.receiving_has_gate_proof(v_inv.receiving_id) then
    raise exception 'Add the gate pass number or picture on delivery % first',
      (select receiving_number from it.receiving_records where id = v_inv.receiving_id);
  end if;
  if not exists (select 1 from it.documents
                 where entity_type = 'invoice' and entity_id = v_inv.id and doc_type = 'Invoice') then
    raise exception 'Upload the invoice file first — it goes to Finance with the package';
  end if;

  update it.invoices
     set status = 'Sent to Finance', sent_to_finance_at = now(), sent_to_finance_by = v_actor, updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;
  select * into v_demand from it.demands where id = v_inv.demand_id;

  perform it.invoice_event(v_inv, 'sent to Finance', false, null);

  -- Finance users = holders of it.payments.update (Phase 6 screen).
  for v_person in
    select distinct ur.person_id
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions perm on perm.id = rp.permission_id and perm.key = 'it.payments.update'
  loop
    perform it.notify_demand_person(v_person, 'invoice_finance',
      format('Invoice package for payment: %s', v_inv.invoice_number),
      format('Demand %s · Rs %s · %s', v_demand.demand_number,
             to_char(v_inv.invoice_amount, 'FM999,999,999,990.00'),
             coalesce((select vendor_name from it.vendors where id = v_inv.vendor_id), 'vendor')),
      v_demand.id);
  end loop;
end;
$$;

-- Invoice file / supporting documents (the app uploads to it-documents/{demand_id}/… first).
create function it.add_invoice_document(
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
    raise exception 'You need Manage Invoices for this site';
  end if;
  if v_inv.status in ('Sent to Finance', 'Confirmed', 'Paid') then
    raise exception 'The package has gone to Finance — ask Finance to attach further documents';
  end if;
  if p_doc_type not in ('Invoice', 'Other') then
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

  perform it.invoice_event(v_inv, format('%s file added: %s', p_doc_type, left(p_file_name, 200)), false, null);
  return v_id;
end;
$$;

revoke all on function it.log_invoice(uuid, text, date, int, numeric, numeric, text) from public;
revoke all on function it.update_invoice(uuid, text, date, int, numeric, numeric, text) from public;
revoke all on function it.clear_invoice_flag(uuid, text) from public;
revoke all on function it.submit_invoice_for_approval(uuid) from public;
revoke all on function it.decide_invoice(uuid, text, text) from public;
revoke all on function it.send_invoice_to_finance(uuid) from public;
revoke all on function it.add_invoice_document(uuid, text, text, text, text, bigint) from public;
grant execute on function it.log_invoice(uuid, text, date, int, numeric, numeric, text) to authenticated;
grant execute on function it.update_invoice(uuid, text, date, int, numeric, numeric, text) to authenticated;
grant execute on function it.clear_invoice_flag(uuid, text) to authenticated;
grant execute on function it.submit_invoice_for_approval(uuid) to authenticated;
grant execute on function it.decide_invoice(uuid, text, text) to authenticated;
grant execute on function it.send_invoice_to_finance(uuid) to authenticated;
grant execute on function it.add_invoice_document(uuid, text, text, text, text, bigint) to authenticated;

-- ===========================================================================
-- PART D — Row Level Security.
-- ===========================================================================

alter table it.invoices enable row level security;

-- Visible with the demand (requester, site staff, approvers, all-sites / Finance).
create policy "invoices readable with the demand" on it.invoices
  for select to authenticated
  using (deleted_at is null and exists (select 1 from it.demands d where d.id = demand_id));

revoke insert, update, delete on it.invoices from authenticated;
grant select on it.invoices to authenticated;

-- Invoice managers may upload into the demand's folder too (Phase 4 allowed site procurement).
drop policy "it-documents insert by demand procurement" on storage.objects;
create policy "it-documents insert by demand procurement" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'it-documents'
    and exists (
      select 1 from it.demands d
      where d.id::text = (storage.foldername(name))[1]
        and d.status not in ('Closed', 'Cancelled')
        and (it.can_process_demand(d.site_id) or it.can_manage_invoices(d.site_id))
    )
  );

-- Approvers of invoices see the demand from Pending Approval onwards already (javaria_it_0011
-- covers demand approvers); invoice-only approvers need it too.
drop policy "demands select own, site staff or approver" on it.demands;
create policy "demands select own, site staff or approver" on it.demands
  for select to authenticated
  using (deleted_at is null
         and (requested_by_person_id = current_person_id()
              or it.can_see_site_demands(site_id)
              or (status not in ('Open', 'Categorized')
                  and (it.is_demand_approver(department_id) or it.is_invoice_approver(department_id)))));

drop policy "demand_updates select" on it.demand_updates;
create policy "demand_updates select" on it.demand_updates
  for select to authenticated
  using (exists (
    select 1 from it.demands d
    where d.id = demand_id
      and (
        it.can_see_site_demands(d.site_id)
        or (not is_internal
            and (d.requested_by_person_id = current_person_id()
                 or (d.status not in ('Open', 'Categorized')
                     and (it.is_demand_approver(d.department_id) or it.is_invoice_approver(d.department_id)))))
      )
  ));

-- Names: invoice approvers resolve people too.
create or replace function it.demand_person_names(p_person_ids uuid[])
returns table (person_id uuid, full_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name
  from persons p
  where p.id = any (p_person_ids)
    and (
      has_permission('it.demands.read')
      or has_permission('it.demands.read_all')
      or has_permission('it.demands.approve')
      or has_permission('it.invoices.approve')
      or has_permission('it.invoices.update')
      or p.id = current_person_id()
      or exists (
        select 1 from it.demands d
        where d.requested_by_person_id = current_person_id()
          and (
            p.id in (d.categorized_by, d.cancelled_by, d.stock_updated_by, d.updated_by)
            or exists (select 1 from it.demand_approvals a
                       where a.demand_id = d.id and a.approver_person_id = p.id)
            or exists (
              select 1 from it.demand_updates u
              where u.demand_id = d.id and u.author_person_id = p.id and not u.is_internal
            )
          )
      )
    );
$$;

-- ===========================================================================
-- PART E — Permissions.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.invoices.update', 'it', 'Manage Invoices',
   'Log vendor invoices against deliveries, upload the invoice file, clear a flagged mismatch, send to approval and to Finance'),
  ('it.invoices.approve', 'it', 'Approve Invoices',
   'Approve or send back invoices — only for departments you''re mapped to as invoice approver'),
  ('it.payments.update', 'it', 'Finance Processing',
   'Receive invoice packages sent to Finance, confirm them and record payments (Phase 6)')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
from roles r
join permissions p on (
     (r.name in ('Admin', 'IT Admin')
        and p.key in ('it.invoices.update', 'it.invoices.approve', 'it.payments.update'))
  or (r.name in ('IT Executive (HQ)', 'IT Site Manager') and p.key = 'it.invoices.update')
)
on conflict do nothing;
