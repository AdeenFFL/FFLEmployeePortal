-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 6 — Finance processing and payments
--              (09-it-procurement-plan.md §5 Phase 6; BRD §5.5.17–5.5.20, ERD D "payments")
-- Depends on:  javaria_it_0014_invoices.sql (it.invoices, it.payments.update)
-- Applied to live DB: NO
--
-- What this does
--   * Finance (it.payments.update, plus it.demands.read_all to see every site's demands):
--       - confirms receipt of an invoice package (Sent to Finance → Confirmed), or returns it to
--         procurement with a reason (→ Approved, e.g. a document missing);
--       - records one or more payments per invoice (BRD §7.9): reference, date, amount, method,
--         remarks, optional payment-proof file. When the payments cover the invoice → Paid.
--         Over-payment is refused.
--   * Vendor email (§5.5.19): recording a payment can email the payment reference to the
--     vendor's address from the Vendor Master (it.notifications.recipient_email; delivered by
--     lib/it/notifications.ts). Payment status: Recorded → Reference Sent to Vendor. Can be re-sent.
--   * Finance SLA (§5.5.17): invoices.finance_due_on = date sent to Finance + finance_sla_days
--     (procurement settings). The daily sweep (it.notify_receiving_followups, same cron job)
--     reminds Finance about overdue packages every reminder interval.
--   * Closing (§5.5.20): when everything approved has been accepted and every delivery's invoice
--     is Paid, the demand closes automatically — its timeline is the complete history.
--
-- Functions REPLACED: it.notify_receiving_followups (adds Finance reminders).
-- Policies REPLACED: storage "it-documents insert by demand procurement" (Finance may upload
-- payment proofs).

-- ===========================================================================
-- PART A — Invoice columns + payments table.
-- ===========================================================================

alter table it.invoices
  add column finance_due_on date,
  add column finance_reminded_on date,
  add column finance_confirmed_at timestamptz,
  add column finance_confirmed_by uuid references public.persons(id),
  add column paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
  add column paid_at timestamptz;

create table it.payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique default it.next_number('PAY'),
  invoice_id uuid not null references it.invoices(id),
  demand_id uuid not null references it.demands(id),
  vendor_id uuid references it.vendors(id),
  site_id uuid references public.org_units(id),
  company_id uuid references public.companies(id),
  payment_reference text not null check (length(trim(payment_reference)) > 0),
  payment_date date not null,
  paid_amount numeric(12, 2) not null check (paid_amount > 0),
  payment_method text not null check (payment_method in ('Bank Transfer', 'Cheque', 'Online', 'Cash', 'Other')),
  status text not null default 'Recorded' check (status in ('Recorded', 'Reference Sent to Vendor')),
  remarks text,
  vendor_notified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create index payments_invoice_idx on it.payments (invoice_id);
create index payments_demand_idx on it.payments (demand_id);
create index payments_date_idx on it.payments (payment_date desc);

create trigger payments_set_updated_at
  before update on it.payments
  for each row execute function public.set_updated_at();

-- Finance due date follows the hand-over (set on every send, so a returned + re-sent package
-- gets a fresh SLA).
create function it.invoices_track_finance_due()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Sent to Finance' and old.status is distinct from 'Sent to Finance' then
    new.finance_due_on := current_date
      + coalesce((select finance_sla_days from it.procurement_settings where id), 5);
    new.finance_reminded_on := null;
  end if;
  return new;
end;
$$;

create trigger trg_invoices_track_finance_due
  before update on it.invoices
  for each row execute function it.invoices_track_finance_due();

update it.invoices
   set finance_due_on = sent_to_finance_at::date
       + coalesce((select finance_sla_days from it.procurement_settings where id), 5)
 where status = 'Sent to Finance' and finance_due_on is null;

-- ===========================================================================
-- PART B — Helpers.
-- ===========================================================================

create function it.is_finance()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.payments.update');
$$;

revoke all on function it.is_finance() from public;
grant execute on function it.is_finance() to authenticated;

-- Queue the vendor's payment email (no portal account — recipient_email). Returns true if queued.
create function it.queue_vendor_payment_email(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay it.payments%rowtype;
  v_inv it.invoices%rowtype;
  v_vendor it.vendors%rowtype;
begin
  select * into v_pay from it.payments where id = p_payment_id;
  select * into v_inv from it.invoices where id = v_pay.invoice_id;
  select * into v_vendor from it.vendors where id = v_pay.vendor_id;
  if v_vendor.email is null or trim(v_vendor.email) = '' then
    return false;
  end if;

  insert into it.notifications (recipient_email, event, title, body, demand_id, invoice_id)
  values (
    trim(v_vendor.email), 'payment_vendor',
    format('Payment made: invoice %s', v_inv.invoice_number),
    format(E'Dear %s,\n\nPayment against your invoice %s dated %s has been made.\n\n'
           || E'Amount: Rs %s\nPayment reference: %s\nPayment date: %s\nMethod: %s\n\n'
           || 'Fauji Foods Limited — IT Procurement',
           coalesce(v_vendor.contact_person, v_vendor.vendor_name), v_inv.invoice_number,
           to_char(v_inv.invoice_date, 'DD Mon YYYY'),
           to_char(v_pay.paid_amount, 'FM999,999,999,990.00'), v_pay.payment_reference,
           to_char(v_pay.payment_date, 'DD Mon YYYY'), v_pay.payment_method),
    v_pay.demand_id, v_inv.id);

  update it.payments
     set status = 'Reference Sent to Vendor', vendor_notified_at = now()
   where id = p_payment_id;
  return true;
end;
$$;

revoke all on function it.queue_vendor_payment_email(uuid) from public;

-- Close the demand once everything approved is accepted and every delivery's invoice is Paid.
create function it.close_demand_if_complete(p_demand_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
begin
  select * into v_demand from it.demands where id = p_demand_id for update;
  if v_demand.status not in ('Received', 'Invoicing') then
    return false;
  end if;
  if v_demand.received_quantity < coalesce(v_demand.approved_quantity, v_demand.quantity) then
    return false;
  end if;
  -- Every delivery with accepted items has an invoice, and all of them are Paid.
  if exists (
    select 1 from it.receiving_records r
    where r.demand_id = p_demand_id and r.deleted_at is null and r.accepted_quantity > 0
      and not exists (select 1 from it.invoices i
                      where i.receiving_id = r.id and i.deleted_at is null and i.status = 'Paid')
  ) then
    return false;
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set status = 'Closed', closed_at = now(), follow_up_on = null, updated_by = current_person_id()
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, current_person_id(), 'system',
          'All deliveries invoiced and paid — demand closed.');
  return true;
end;
$$;

revoke all on function it.close_demand_if_complete(uuid) from public;

-- ===========================================================================
-- PART C — Finance functions.
-- ===========================================================================

create function it.confirm_invoice_package(p_invoice_id uuid, p_note text)
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
  if v_actor is null or not it.is_finance() then
    raise exception 'Only Finance can confirm an invoice package';
  end if;
  if v_inv.status <> 'Sent to Finance' then
    raise exception 'Only a package sent to Finance can be confirmed (it is %)', v_inv.status;
  end if;

  update it.invoices
     set status = 'Confirmed', finance_confirmed_at = now(), finance_confirmed_by = v_actor, updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv,
    'received and confirmed by Finance' || coalesce(' — ' || nullif(trim(p_note), ''), ''), true,
    format('Finance confirmed invoice %s', v_inv.invoice_number));
end;
$$;

-- Package incomplete / wrong → back to procurement (Approved) with the reason.
create function it.return_invoice_package(p_invoice_id uuid, p_reason text)
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
  if v_actor is null or not it.is_finance() then
    raise exception 'Only Finance can return an invoice package';
  end if;
  if v_inv.status not in ('Sent to Finance', 'Confirmed') or v_inv.paid_amount > 0 then
    raise exception 'Only an unpaid package with Finance can be returned';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Please say what procurement needs to fix';
  end if;

  update it.invoices
     set status = 'Approved', revision_reason = trim(p_reason), finance_due_on = null,
         finance_confirmed_at = null, finance_confirmed_by = null,
         sent_to_finance_at = null, sent_to_finance_by = null, updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  perform it.invoice_event(v_inv, 'returned by Finance — ' || trim(p_reason), true,
    format('Finance returned invoice %s', v_inv.invoice_number));
end;
$$;

-- §5.5.18–5.5.19: record a payment; optionally email the reference to the vendor.
create function it.record_payment(
  p_invoice_id uuid,
  p_reference text,
  p_payment_date date,
  p_amount numeric,
  p_method text,
  p_remarks text,
  p_notify_vendor boolean
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
  v_remaining numeric(12, 2);
  v_emailed boolean := false;
  v_number text;
begin
  select * into v_inv from it.invoices where id = p_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_actor is null or not it.is_finance() then
    raise exception 'Only Finance can record payments';
  end if;
  if v_inv.status not in ('Sent to Finance', 'Confirmed') then
    raise exception 'Payments can be recorded only for a package with Finance (it is %)', v_inv.status;
  end if;
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'Enter the payment reference (cheque / transaction no.)';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'The payment date can''t be in the future';
  end if;
  if p_method not in ('Bank Transfer', 'Cheque', 'Online', 'Cash', 'Other') then
    raise exception 'Choose the payment method';
  end if;
  v_remaining := v_inv.invoice_amount - v_inv.paid_amount;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) > v_remaining then
    raise exception 'The amount must be more than 0 and at most Rs % still unpaid',
      to_char(v_remaining, 'FM999,999,999,990.00');
  end if;

  insert into it.payments (invoice_id, demand_id, vendor_id, site_id, company_id, payment_reference,
                           payment_date, paid_amount, payment_method, remarks, created_by, updated_by)
  values (v_inv.id, v_inv.demand_id, v_inv.vendor_id, v_inv.site_id, v_inv.company_id, trim(p_reference),
          p_payment_date, round(p_amount, 2), p_method, nullif(trim(p_remarks), ''), v_actor, v_actor)
  returning id, payment_number into v_id, v_number;

  -- Recording a payment implies Finance has the package.
  update it.invoices
     set paid_amount = paid_amount + round(p_amount, 2),
         status = case when paid_amount + round(p_amount, 2) >= invoice_amount then 'Paid' else 'Confirmed' end,
         paid_at = case when paid_amount + round(p_amount, 2) >= invoice_amount then now() else paid_at end,
         finance_confirmed_at = coalesce(finance_confirmed_at, now()),
         finance_confirmed_by = coalesce(finance_confirmed_by, v_actor),
         updated_by = v_actor
   where id = p_invoice_id
  returning * into v_inv;

  if coalesce(p_notify_vendor, false) then
    v_emailed := it.queue_vendor_payment_email(v_id);
  end if;

  perform it.invoice_event(v_inv,
    format('payment %s: Rs %s by %s, ref %s%s%s', v_number,
           to_char(round(p_amount, 2), 'FM999,999,999,990.00'), p_method, trim(p_reference),
           case when v_inv.status = 'Paid' then ' — fully paid'
                else format(' — Rs %s still unpaid',
                            to_char(v_inv.invoice_amount - v_inv.paid_amount, 'FM999,999,999,990.00')) end,
           case when v_emailed then ' · reference emailed to vendor'
                when coalesce(p_notify_vendor, false) then ' · vendor has no email, not sent'
                else '' end),
    true, format('Invoice %s %s', v_inv.invoice_number,
                 case when v_inv.status = 'Paid' then 'paid' else 'part-paid' end));

  if v_inv.status = 'Paid' then
    perform it.close_demand_if_complete(v_inv.demand_id);
  end if;
  return v_id;
end;
$$;

-- Re-send (or first send) the payment reference to the vendor.
create function it.send_payment_reference(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay it.payments%rowtype;
begin
  select * into v_pay from it.payments where id = p_payment_id and deleted_at is null;
  if not found then
    raise exception 'Payment not found';
  end if;
  if current_person_id() is null or not it.is_finance() then
    raise exception 'Only Finance can email payment references';
  end if;
  if not it.queue_vendor_payment_email(p_payment_id) then
    raise exception 'The vendor has no email address — add one in the Vendor Master';
  end if;
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (v_pay.demand_id, current_person_id(), 'system',
          format('Payment reference %s emailed to the vendor', v_pay.payment_reference));
end;
$$;

-- Payment proof (bank advice, cheque copy) — Finance uploads into the demand's folder.
create function it.add_payment_document(
  p_payment_id uuid,
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
  v_pay it.payments%rowtype;
  v_id uuid;
begin
  select * into v_pay from it.payments where id = p_payment_id and deleted_at is null;
  if not found then
    raise exception 'Payment not found';
  end if;
  if current_person_id() is null or not it.is_finance() then
    raise exception 'Only Finance can add payment proofs';
  end if;
  if split_part(p_storage_path, '/', 1) <> v_pay.demand_id::text then
    raise exception 'Invalid file path';
  end if;

  insert into it.documents (entity_type, entity_id, demand_id, doc_type, storage_path, file_name,
                            content_type, size_bytes, uploaded_by)
  values ('payment', p_payment_id, v_pay.demand_id, 'Payment Proof', p_storage_path, left(p_file_name, 200),
          p_content_type, p_size_bytes, current_person_id())
  returning id into v_id;

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (v_pay.demand_id, current_person_id(), 'system',
          format('Payment proof added for %s: %s', v_pay.payment_number, left(p_file_name, 200)));
  return v_id;
end;
$$;

revoke all on function it.confirm_invoice_package(uuid, text) from public;
revoke all on function it.return_invoice_package(uuid, text) from public;
revoke all on function it.record_payment(uuid, text, date, numeric, text, text, boolean) from public;
revoke all on function it.send_payment_reference(uuid) from public;
revoke all on function it.add_payment_document(uuid, text, text, text, bigint) from public;
grant execute on function it.confirm_invoice_package(uuid, text) to authenticated;
grant execute on function it.return_invoice_package(uuid, text) to authenticated;
grant execute on function it.record_payment(uuid, text, date, numeric, text, text, boolean) to authenticated;
grant execute on function it.send_payment_reference(uuid) to authenticated;
grant execute on function it.add_payment_document(uuid, text, text, text, bigint) to authenticated;

-- ===========================================================================
-- PART D — Row Level Security.
-- ===========================================================================

alter table it.payments enable row level security;

create policy "payments readable with the demand" on it.payments
  for select to authenticated
  using (deleted_at is null and exists (select 1 from it.demands d where d.id = demand_id));

revoke insert, update, delete on it.payments from authenticated;
grant select on it.payments to authenticated;

-- Finance may upload payment proofs into the demand's folder (closed demands excluded as before,
-- except Finance: the payment that closes a demand can still get its proof afterwards).
drop policy "it-documents insert by demand procurement" on storage.objects;
create policy "it-documents insert by demand procurement" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'it-documents'
    and exists (
      select 1 from it.demands d
      where d.id::text = (storage.foldername(name))[1]
        and (
          (d.status not in ('Closed', 'Cancelled')
           and (it.can_process_demand(d.site_id) or it.can_manage_invoices(d.site_id)))
          or (it.is_finance() and d.status <> 'Cancelled')
        )
    )
  );

-- ===========================================================================
-- PART E — Daily sweep: + Finance SLA reminders (same cron job:
--   select cron.schedule('it-receiving-followups', '0 9 * * *',
--                        $$select it.notify_receiving_followups()$$);).
-- ===========================================================================

create or replace function it.notify_receiving_followups()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
  v_inv it.invoices%rowtype;
  v_person uuid;
  v_count int := 0;
  v_target int;
  v_interval int := it.reminder_interval_days();
begin
  -- Deliveries due / short.
  for v_demand in
    select * from it.demands
    where deleted_at is null
      and status in ('Assigned to Vendor', 'Partially Received')
      and follow_up_on is not null
      and follow_up_on <= current_date
    for update skip locked
  loop
    v_target := coalesce(v_demand.approved_quantity, v_demand.quantity);
    perform it.notify_demand_processors(v_demand.site_id, 'demand_followup',
      format('Follow up delivery: demand %s', v_demand.demand_number),
      format('%s of %s accepted from %s%s.', v_demand.received_quantity, v_target,
             coalesce((select vendor_name from it.vendors where id = v_demand.vendor_id), 'the vendor'),
             coalesce(', expected ' || to_char(v_demand.expected_delivery_date, 'DD Mon YYYY'), '')),
      v_demand.id);

    perform set_config('it.demand_system', 'on', true);
    update it.demands set follow_up_on = current_date + v_interval where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
    v_count := v_count + 1;
  end loop;

  -- Approvals waiting.
  for v_demand in
    select * from it.demands
    where deleted_at is null
      and status = 'Pending Approval'
      and approval_follow_up_on is not null
      and approval_follow_up_on <= current_date
    for update skip locked
  loop
    for v_person in select person_id from it.demand_approvers_for(v_demand.department_id) loop
      if v_person is distinct from v_demand.requested_by_person_id then
        perform it.notify_demand_person(v_person, 'demand_approval_reminder',
          format('Reminder: demand %s is waiting for your approval', v_demand.demand_number),
          format('%s × %s for %s is still waiting for a decision.', v_demand.quantity,
                 (select product_name from it.products where id = v_demand.product_id),
                 (select name from org_units where id = v_demand.department_id)),
          v_demand.id);
      end if;
    end loop;

    perform set_config('it.demand_system', 'on', true);
    update it.demands set approval_follow_up_on = current_date + v_interval where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
    v_count := v_count + 1;
  end loop;

  -- Finance SLA (§5.5.17): overdue packages, reminded every reminder interval.
  for v_inv in
    select * from it.invoices
    where deleted_at is null
      and status in ('Sent to Finance', 'Confirmed')
      and finance_due_on is not null
      and finance_due_on <= current_date
      and (finance_reminded_on is null or finance_reminded_on <= current_date - v_interval)
    for update skip locked
  loop
    for v_person in
      select distinct ur.person_id
      from user_roles ur
      join role_permissions rp on rp.role_id = ur.role_id
      join permissions perm on perm.id = rp.permission_id and perm.key = 'it.payments.update'
    loop
      perform it.notify_demand_person(v_person, 'invoice_finance_overdue',
        format('Overdue at Finance: invoice %s', v_inv.invoice_number),
        format('Due %s · Rs %s unpaid · %s', to_char(v_inv.finance_due_on, 'DD Mon YYYY'),
               to_char(v_inv.invoice_amount - v_inv.paid_amount, 'FM999,999,999,990.00'),
               coalesce((select vendor_name from it.vendors where id = v_inv.vendor_id), 'vendor')),
        v_inv.demand_id);
    end loop;
    update it.invoices set finance_reminded_on = current_date where id = v_inv.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function it.notify_receiving_followups() from public;
