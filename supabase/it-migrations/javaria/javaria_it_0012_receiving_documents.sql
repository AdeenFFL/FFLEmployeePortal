-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 4 — Vendor assignment, goods receiving and documents
--              (09-it-procurement-plan.md §5 Phase 4; BRD §5.5.7–5.5.9, §5.6.8; additions P1)
-- Depends on:  javaria_it_0010_demands.sql, javaria_it_0011_demand_approvals.sql
-- Applied to live DB: NO
--
-- What this does
--   * Vendor assignment (§5.5.7): site procurement picks an active vendor from the master for an
--     Approved / Partially Approved demand, with an expected delivery date → Assigned to Vendor.
--     The vendor can be changed until everything is received (§5.6.8 re-assign).
--   * it.receiving_records (§5.5.8–5.5.9): one row per delivery (GRN-000123) — date, quantity,
--     condition, Delivery Challan no., Inward Gate Pass no., remarks. Deliveries add up against
--     the approved quantity: all in → Received, some → Partially Received. Over-receipt refused.
--     A delivery of 0 is logged as "Not Received" (vendor no-show) for the record.
--   * Gate pass and challan are OPTIONAL (decided 2026-10-22 with Javaria): number and/or
--     picture can be added at receiving or later. A delivery with neither shows "Gate pass
--     pending". it.receiving_has_gate_proof() is the check Phase 5 uses: an invoice can't be sent
--     to Finance until each delivery on it has a gate pass number OR a gate pass picture.
--   * it.documents + private bucket `it-documents` (P1, accepted as 07 §1.3 #3): generic file
--     store keyed by entity_type / entity_id. This phase uses 'demand' and 'receiving'; invoices,
--     payments and Talha's assets can use it later. Files live at {demand_id}/{random}-{name}.
--   * Follow-ups: demands.follow_up_on = expected delivery date, or receiving date + reminder
--     interval after a short delivery. it.notify_receiving_followups() (pg_cron, Part F) reminds
--     site procurement and pushes the date forward by the reminder interval.
--   * Fixed-asset products: Talha's registerAssetsFromReceipt() isn't built (07 Phase 7), so
--     serial numbers go in the remarks and assets are registered by hand (plan §2 interim).
--     Then tell Talha it.receiving_records is live so he can add assets.receiving_id's FK.
--   All writes go through security-definer functions; the tables have no direct write grants.

-- ===========================================================================
-- PART A — Demand columns.
-- ===========================================================================

alter table it.demands
  add column expected_delivery_date date,
  add column vendor_assigned_at timestamptz,
  add column vendor_assigned_by uuid references public.persons(id),
  add column follow_up_on date,
  add column received_quantity int not null default 0 check (received_quantity >= 0);

-- ===========================================================================
-- PART B — Receiving records.
-- ===========================================================================

create table it.receiving_records (
  id uuid primary key default gen_random_uuid(),
  receiving_number text not null unique default it.next_number('GRN'),
  demand_id uuid not null references it.demands(id),
  vendor_id uuid references it.vendors(id),
  received_by_person_id uuid references public.persons(id),
  received_date date not null,
  received_quantity int not null check (received_quantity >= 0),
  condition text not null default 'Good' check (condition in ('Good', 'Partially Damaged', 'Damaged')),
  status text not null check (status in ('Full', 'Partial', 'Not Received')),
  delivery_challan_no text,
  gate_pass_no text,
  remarks text,
  site_id uuid references public.org_units(id),
  company_id uuid references public.companies(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create index receiving_records_demand_idx on it.receiving_records (demand_id, received_date);
create index receiving_records_vendor_idx on it.receiving_records (vendor_id);

create trigger receiving_records_set_updated_at
  before update on it.receiving_records
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- PART C — Documents (P1) + bucket.
-- ===========================================================================

create table it.documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('demand', 'receiving', 'invoice', 'payment', 'asset')),
  entity_id uuid not null,
  demand_id uuid references it.demands(id) on delete cascade, -- set for procurement documents
  doc_type text not null check (doc_type in (
    'Delivery Challan', 'Gate Pass', 'Quotation', 'Invoice', 'Approval', 'Payment Proof', 'Photo', 'Other'
  )),
  storage_path text not null unique,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.persons(id),
  uploaded_at timestamptz not null default now()
);

create index documents_entity_idx on it.documents (entity_type, entity_id);
create index documents_demand_idx on it.documents (demand_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('it-documents', 'it-documents', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- ===========================================================================
-- PART D — Helpers.
-- ===========================================================================

-- Phase 5 rule: proof the goods came through the gate = a number OR a picture.
create function it.receiving_has_gate_proof(p_receiving_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from it.receiving_records r
    where r.id = p_receiving_id
      and (nullif(trim(r.gate_pass_no), '') is not null
           or exists (select 1 from it.documents d
                      where d.entity_type = 'receiving' and d.entity_id = r.id and d.doc_type = 'Gate Pass'))
  );
$$;

create function it.reminder_interval_days()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select reminder_interval_days from it.procurement_settings where id), 2);
$$;

revoke all on function it.receiving_has_gate_proof(uuid) from public;
revoke all on function it.reminder_interval_days() from public;
grant execute on function it.receiving_has_gate_proof(uuid) to authenticated;

-- ===========================================================================
-- PART E — Workflow functions.
-- ===========================================================================

-- §5.5.7 / §5.6.8: assign or change the vendor.
create function it.assign_demand_vendor(
  p_demand_id uuid,
  p_vendor_id uuid,
  p_expected_date date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_vendor text;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can assign a vendor';
  end if;
  if v_demand.status not in ('Approved', 'Partially Approved', 'Assigned to Vendor', 'Partially Received') then
    raise exception 'A vendor can be assigned only after approval and before everything is received (demand is %)',
      v_demand.status;
  end if;
  select vendor_name into v_vendor from it.vendors where id = p_vendor_id and is_active;
  if v_vendor is null then
    raise exception 'Please choose an active vendor from the Vendor Master';
  end if;
  if p_expected_date is not null and p_expected_date < current_date - 30 then
    raise exception 'The expected delivery date looks wrong';
  end if;
  if p_vendor_id is not distinct from v_demand.vendor_id
     and p_expected_date is not distinct from v_demand.expected_delivery_date then
    raise exception 'Nothing changed';
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set vendor_id = p_vendor_id,
         expected_delivery_date = p_expected_date,
         vendor_assigned_at = now(),
         vendor_assigned_by = v_actor,
         follow_up_on = coalesce(p_expected_date, current_date + it.reminder_interval_days()),
         status = case when status in ('Approved', 'Partially Approved') then 'Assigned to Vendor' else status end,
         updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  -- The vendor itself is logged by it.log_demand_changes(); this adds the date and the reason.
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          case when v_demand.vendor_id is null then 'Ordered from ' else 'Vendor changed to ' end
          || v_vendor
          || coalesce(', expected ' || to_char(p_expected_date, 'DD Mon YYYY'), '')
          || coalesce(' — ' || nullif(trim(p_note), ''), ''));
end;
$$;

-- §5.5.8–5.5.9: record a delivery. Returns the receiving record id (for uploads).
create function it.record_receiving(
  p_demand_id uuid,
  p_received_date date,
  p_quantity int,
  p_condition text,
  p_challan_no text,
  p_gate_pass_no text,
  p_remarks text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_target int;
  v_total int;
  v_id uuid;
  v_status text;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can record receiving';
  end if;
  if v_demand.status not in ('Assigned to Vendor', 'Partially Received') then
    raise exception 'Assign a vendor before recording a delivery (demand is %)', v_demand.status;
  end if;
  if p_received_date is null or p_received_date > current_date then
    raise exception 'The received date can''t be in the future';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Enter the quantity received (0 if nothing arrived)';
  end if;
  if p_condition not in ('Good', 'Partially Damaged', 'Damaged') then
    raise exception 'Choose the condition of the goods';
  end if;

  v_target := coalesce(v_demand.approved_quantity, v_demand.quantity);
  v_total := v_demand.received_quantity + p_quantity;
  if v_total > v_target then
    raise exception 'That would receive % in total, more than the % approved (% still due)',
      v_total, v_target, v_target - v_demand.received_quantity;
  end if;
  if p_quantity = 0 and coalesce(trim(p_remarks), '') = '' then
    raise exception 'Please note why nothing was received';
  end if;

  v_status := case when p_quantity = 0 then 'Not Received'
                   when v_total >= v_target then 'Full'
                   else 'Partial' end;

  insert into it.receiving_records (
    demand_id, vendor_id, received_by_person_id, received_date, received_quantity, condition, status,
    delivery_challan_no, gate_pass_no, remarks, site_id, company_id, created_by, updated_by)
  values (
    p_demand_id, v_demand.vendor_id, v_actor, p_received_date, p_quantity, p_condition, v_status,
    nullif(trim(p_challan_no), ''), nullif(trim(p_gate_pass_no), ''), nullif(trim(p_remarks), ''),
    v_demand.site_id, v_demand.company_id, v_actor, v_actor)
  returning id into v_id;

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set received_quantity = v_total,
         status = case when v_total >= v_target then 'Received'
                       when v_total > 0 then 'Partially Received'
                       else status end,
         follow_up_on = case when v_total >= v_target then null
                             else p_received_date + it.reminder_interval_days() end,
         updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          format('Delivery %s: %s received (%s of %s in total), condition %s',
                 (select receiving_number from it.receiving_records where id = v_id),
                 p_quantity, v_total, v_target, p_condition)
          || case when v_total < v_target then format(' — %s still due', v_target - v_total) else '' end
          || case when nullif(trim(p_gate_pass_no), '') is null then ' · gate pass pending' else '' end);

  return v_id;
end;
$$;

-- Fill in the challan / gate pass number later (the picture is an it.documents upload).
create function it.update_receiving_refs(p_receiving_id uuid, p_challan_no text, p_gate_pass_no text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_rec it.receiving_records%rowtype;
  v_site uuid;
  v_challan text := nullif(trim(p_challan_no), '');
  v_gate text := nullif(trim(p_gate_pass_no), '');
begin
  select * into v_rec from it.receiving_records where id = p_receiving_id and deleted_at is null for update;
  if not found then
    raise exception 'Delivery not found';
  end if;
  select site_id into v_site from it.demands where id = v_rec.demand_id;
  if v_actor is null or not it.can_process_demand(v_site) then
    raise exception 'Only the site''s procurement staff can update a delivery';
  end if;
  if v_challan is not distinct from v_rec.delivery_challan_no and v_gate is not distinct from v_rec.gate_pass_no then
    raise exception 'Nothing changed';
  end if;

  update it.receiving_records
     set delivery_challan_no = v_challan, gate_pass_no = v_gate, updated_by = v_actor
   where id = p_receiving_id;

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (v_rec.demand_id, v_actor, 'system',
          format('Delivery %s: challan %s, gate pass %s', v_rec.receiving_number,
                 coalesce(v_challan, '—'), coalesce(v_gate, '—')));
end;
$$;

-- Register an uploaded file (the app uploads to the bucket first, then calls this).
create function it.add_procurement_document(
  p_demand_id uuid,
  p_receiving_id uuid,
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
  v_demand it.demands%rowtype;
  v_number text;
  v_id uuid;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can add documents';
  end if;
  if v_demand.status in ('Closed', 'Cancelled') then
    raise exception 'This demand is %', lower(v_demand.status);
  end if;
  if split_part(p_storage_path, '/', 1) <> p_demand_id::text then
    raise exception 'Invalid file path';
  end if;
  if p_receiving_id is not null then
    select receiving_number into v_number from it.receiving_records
    where id = p_receiving_id and demand_id = p_demand_id and deleted_at is null;
    if v_number is null then
      raise exception 'Delivery not found on this demand';
    end if;
  end if;

  insert into it.documents (entity_type, entity_id, demand_id, doc_type, storage_path, file_name,
                            content_type, size_bytes, uploaded_by)
  values (case when p_receiving_id is null then 'demand' else 'receiving' end,
          coalesce(p_receiving_id, p_demand_id), p_demand_id, p_doc_type, p_storage_path,
          left(p_file_name, 200), p_content_type, p_size_bytes, v_actor)
  returning id into v_id;

  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system',
          format('%s added: %s', p_doc_type, left(p_file_name, 200))
          || coalesce(' (delivery ' || v_number || ')', ''));
  return v_id;
end;
$$;

revoke all on function it.assign_demand_vendor(uuid, uuid, date, text) from public;
revoke all on function it.record_receiving(uuid, date, int, text, text, text, text) from public;
revoke all on function it.update_receiving_refs(uuid, text, text) from public;
revoke all on function it.add_procurement_document(uuid, uuid, text, text, text, text, bigint) from public;
grant execute on function it.assign_demand_vendor(uuid, uuid, date, text) to authenticated;
grant execute on function it.record_receiving(uuid, date, int, text, text, text, text) to authenticated;
grant execute on function it.update_receiving_refs(uuid, text, text) to authenticated;
grant execute on function it.add_procurement_document(uuid, uuid, text, text, text, text, bigint) to authenticated;

-- ===========================================================================
-- PART F — Follow-up reminders (pg_cron, same pattern as it.notify_sla_breaches):
--   select cron.schedule('it-receiving-followups', '0 9 * * *',
--                        $$select it.notify_receiving_followups()$$);
-- Until scheduled, it can be run by hand from the SQL editor.
-- ===========================================================================

create function it.notify_receiving_followups()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
  v_count int := 0;
  v_target int;
begin
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
      format('%s of %s received from %s%s.', v_demand.received_quantity, v_target,
             coalesce((select vendor_name from it.vendors where id = v_demand.vendor_id), 'the vendor'),
             coalesce(', expected ' || to_char(v_demand.expected_delivery_date, 'DD Mon YYYY'), '')),
      v_demand.id);

    perform set_config('it.demand_system', 'on', true);
    update it.demands set follow_up_on = current_date + it.reminder_interval_days() where id = v_demand.id;
    perform set_config('it.demand_system', 'off', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function it.notify_receiving_followups() from public;

-- ===========================================================================
-- PART G — Row Level Security (reads only; writes through the functions above).
-- ===========================================================================

alter table it.receiving_records enable row level security;
alter table it.documents enable row level security;

-- Visible with the demand (it.demands' own RLS decides).
create policy "receiving_records readable with the demand" on it.receiving_records
  for select to authenticated
  using (deleted_at is null and exists (select 1 from it.demands d where d.id = demand_id));

create policy "documents readable with the demand" on it.documents
  for select to authenticated
  using (demand_id is not null and exists (select 1 from it.demands d where d.id = demand_id));

revoke insert, update, delete on it.receiving_records from authenticated;
revoke insert, update, delete on it.documents from authenticated;
grant select on it.receiving_records, it.documents to authenticated;

-- Storage: upload into a demand's folder = site procurement of that demand; read a file = you can
-- see its it.documents row (so an uploaded-but-unregistered file is invisible).
create policy "it-documents insert by demand procurement" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'it-documents'
    and exists (
      select 1 from it.demands d
      where d.id::text = (storage.foldername(name))[1]
        and d.status not in ('Closed', 'Cancelled')
        and it.can_process_demand(d.site_id)
    )
  );

create policy "it-documents select via document row" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'it-documents'
    and exists (select 1 from it.documents doc where doc.storage_path = name)
  );
