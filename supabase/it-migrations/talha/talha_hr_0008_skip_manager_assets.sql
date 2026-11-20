-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding clearance - (A) skip a part for one request, (B) line manager confirms
--              "Complete Data received", (C) IT assets are returned from the clearance form
-- Depends on:  talha_hr_0001 .. 0007 (live), it.asset_assignments / it.assets (talha_it_0004, 0003).
-- Applied to live DB: YES (2026-11-19, by Talha)
--
-- (A) SKIP A PART FOR ONE REQUEST
--   A site may have no Store / Admin / Finance manager. The HRBP can SKIP that part for ONE request
--   with a reason (never the HR part). A skipped part needs no signature, its checklist lines
--   become N/A ("Skipped: <reason>"), and the page-one tick for that form follows by itself.
--     hr.clearance_skips                    who skipped what and why
--     hr.skip_clearance_slot / unskip_...   hr.clearance_forward holders only
--     hr.clearance_missing_for_case(case)   parts that still have NO signer and are NOT skipped
--   CHANGE: a case that HR/HRBP STARTS for an employee now begins as Submitted (like a self
--   request), so the HRBP can skip parts first and then Forward. Before, it went straight into
--   clearance and failed when a signer was missing.
--
-- (B) LINE MANAGER CONFIRMS "COMPLETE DATA RECEIVED BY LINE MANAGER"
--   The HR signer picks the employee's line manager on the case. The manager then confirms in the
--   portal (any employee can be a line manager; no special permission). That confirmation fills
--   the page-one line p1.data_received with Yes by itself. While a line manager is set, HR cannot
--   answer that line by hand (change or clear the manager instead).
--     cases.line_manager_person_id, data_received_confirmed_by / _at
--     hr.set_clearance_line_manager, hr.clearance_search_managers,
--     hr.my_handover_requests, hr.confirm_data_received
--
-- (C) IT ASSETS ARE RETURNED FROM THE CLEARANCE FORM
--   The IT signer sees the assets the employee still holds and marks each one returned (or Lost)
--   right there. That closes the assignment and updates the inventory (asset status) at once.
--   The IT part cannot be signed while an asset is still assigned (BRD: inventory must be updated).
--     hr.clearance_list_open_assets, hr.clearance_return_asset
--
-- REPLACED (same names and arguments): hr.create_clearance_case_internal, hr.forward_clearance_case,
--   hr.set_clearance_response, hr.sign_clearance. Their previous versions are in talha_hr_0001/0003.
--
-- ASSUMPTIONS: only the HRBP (hr.clearance.forward) skips parts; IT cannot sign while assets are
--   still assigned; a returned asset becomes Unassigned, Retired or Lost (never In Repair).
--
-- Safe to undo: re-run the four replaced functions as they are in talha_hr_0001 (forward) and
--   talha_hr_0003 (the other three), then:
--   drop function hr.clearance_return_asset(uuid, uuid, text, text, text);
--   drop function hr.clearance_list_open_assets(uuid);
--   drop function hr.confirm_data_received(uuid);
--   drop function hr.my_handover_requests();
--   drop function hr.clearance_search_managers(text, integer);
--   drop function hr.set_clearance_line_manager(uuid, uuid);
--   drop function hr.unskip_clearance_slot(uuid, text);
--   drop function hr.skip_clearance_slot(uuid, text, text);
--   drop function hr.clearance_missing_for_case(uuid);
--   drop function hr.clearance_refresh_autoticks(uuid, text);
--   drop table hr.clearance_skips;
--   alter table hr.clearance_cases drop column line_manager_person_id,
--     drop column data_received_confirmed_by, drop column data_received_confirmed_at;

begin;

-- =====================================================================
-- 1. New columns and table
-- =====================================================================
alter table hr.clearance_cases
  add column line_manager_person_id     uuid references public.persons (id) on delete set null,
  add column data_received_confirmed_by uuid references public.persons (id) on delete set null,
  add column data_received_confirmed_at timestamptz;

create table hr.clearance_skips (
  case_id     uuid not null references hr.clearance_cases (id) on delete cascade,
  slot_key    text not null references hr.clearance_slots (slot_key),
  reason      text not null check (length(btrim(reason)) between 3 and 300),
  skipped_by  uuid references public.persons (id) on delete set null,
  skipped_at  timestamptz not null default now(),
  primary key (case_id, slot_key)
);

grant select on hr.clearance_skips to authenticated;
grant select, insert, update, delete on hr.clearance_skips to service_role;
revoke insert, update, delete on hr.clearance_skips from authenticated;

alter table hr.clearance_skips enable row level security;

create policy "skips readable with the case"
  on hr.clearance_skips for select to authenticated
  using (exists (select 1 from hr.clearance_cases c where c.id = clearance_skips.case_id));

-- =====================================================================
-- 2. Internal helper: page-one ticks for Admin / Accounts / IT follow the signatures and skips
-- =====================================================================
create or replace function hr.clearance_refresh_autoticks(p_case_id uuid, p_form_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  if p_form_key is null or p_form_key not in ('admin', 'accounts', 'it') then
    return;
  end if;

  -- a signer of this form is still expected: the tick stays empty
  if exists (
       select 1 from hr.clearance_slots s
        where s.is_active and s.form_key = p_form_key
          and not exists (select 1 from hr.clearance_signoffs o
                           where o.case_id = p_case_id and o.slot_key = s.slot_key)
          and not exists (select 1 from hr.clearance_skips k
                           where k.case_id = p_case_id and k.slot_key = s.slot_key)) then
    update hr.clearance_responses r
       set outcome = null, responded_at = null
      from hr.clearance_lines l
     where r.line_id = l.id and r.case_id = p_case_id
       and l.is_active and l.auto_from_form = p_form_key;
    return;
  end if;

  select case
           -- every part of this form was skipped
           when not exists (
                  select 1 from hr.clearance_slots s
                   where s.is_active and s.form_key = p_form_key
                     and not exists (select 1 from hr.clearance_skips k
                                      where k.case_id = p_case_id and k.slot_key = s.slot_key))
             then 'N/A'
           -- the form has a "No" answer
           when exists (
                  select 1
                    from hr.clearance_responses r
                    join hr.clearance_lines l2 on l2.id = r.line_id
                   where r.case_id = p_case_id and l2.form_key = p_form_key
                     and l2.is_active and l2.auto_from_form is null
                     and r.outcome = 'No')
             then 'No'
           else 'Yes'
         end
    into v_outcome;

  insert into hr.clearance_responses (case_id, line_id, outcome, responded_at)
  select p_case_id, l.id, v_outcome, now()
    from hr.clearance_lines l
   where l.is_active and l.auto_from_form = p_form_key
  on conflict (case_id, line_id) do update
     set outcome = excluded.outcome, responded_at = excluded.responded_at;
end;
$$;

-- =====================================================================
-- 3. (A) Parts that still have no signer and are not skipped
-- =====================================================================
create or replace function hr.clearance_missing_for_case(p_case_id uuid)
returns table (slot_key text, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_case record;
begin
  if not (public.has_permission('hr.clearance.forward')
          or public.has_permission('hr.clearance.read_all')) then
    raise exception 'You are not allowed to view this.' using errcode = '42501';
  end if;

  select c.site_id, c.department_id into v_case
    from hr.clearance_cases c where c.id = p_case_id;
  if not found then
    raise exception 'Request not found.';
  end if;

  return query
    select s.slot_key, s.label
      from hr.clearance_slots s
     where s.is_active
       and not exists (select 1 from hr.clearance_skips k
                        where k.case_id = p_case_id and k.slot_key = s.slot_key)
       and not exists (
             select 1 from hr.clearance_signers g
              where g.slot_key = s.slot_key
                and ((s.scope = 'site'       and g.site_id       = v_case.site_id)
                  or (s.scope = 'department' and g.department_id = v_case.department_id)))
     order by s.sort_order;
end;
$$;

-- =====================================================================
-- 4. (A) Skip / un-skip a part for one request
-- =====================================================================
create or replace function hr.skip_clearance_slot(p_case_id uuid, p_slot_key text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_person_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_case   record;
  v_slot   record;
begin
  if v_me is null or not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to skip parts of a clearance.' using errcode = '42501';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Please give a short reason (3 to 300 characters).';
  end if;

  select c.id, c.status into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.status not in ('Submitted', 'In Clearance') then
    raise exception 'A % request cannot be changed.', v_case.status;
  end if;

  select s.slot_key, s.form_key, s.is_active into v_slot
    from hr.clearance_slots s where s.slot_key = p_slot_key;
  if not found or not v_slot.is_active then
    raise exception 'Signature slot not found.';
  end if;
  if p_slot_key = 'hr' then
    raise exception 'The HR part cannot be skipped.';
  end if;
  if exists (select 1 from hr.clearance_signoffs o
              where o.case_id = p_case_id and o.slot_key = p_slot_key) then
    raise exception 'This part is already signed, so it cannot be skipped.';
  end if;

  insert into hr.clearance_skips (case_id, slot_key, reason, skipped_by)
  values (p_case_id, p_slot_key, v_reason, v_me)
  on conflict (case_id, slot_key) do update
     set reason = excluded.reason, skipped_by = excluded.skipped_by, skipped_at = now();

  -- the lines of the skipped part become N/A
  insert into hr.clearance_responses (case_id, line_id, outcome, remarks, responded_by, responded_at)
  select p_case_id, l.id, 'N/A', 'Skipped: ' || v_reason, v_me, now()
    from hr.clearance_lines l
   where l.slot_key = p_slot_key and l.is_active and l.auto_from_form is null
  on conflict (case_id, line_id) do update
     set outcome = 'N/A', remarks = excluded.remarks,
         responded_by = excluded.responded_by, responded_at = excluded.responded_at;

  perform hr.clearance_refresh_autoticks(p_case_id, v_slot.form_key);
end;
$$;

create or replace function hr.unskip_clearance_slot(p_case_id uuid, p_slot_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_person_id();
  v_case record;
  v_form text;
begin
  if v_me is null or not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to change a clearance.' using errcode = '42501';
  end if;

  select c.id, c.status into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.status not in ('Submitted', 'In Clearance') then
    raise exception 'A % request cannot be changed.', v_case.status;
  end if;

  delete from hr.clearance_skips where case_id = p_case_id and slot_key = p_slot_key;
  if not found then
    raise exception 'This part is not skipped.';
  end if;

  update hr.clearance_responses r
     set outcome = null, remarks = null, responded_by = null, responded_at = null
    from hr.clearance_lines l
   where r.line_id = l.id and r.case_id = p_case_id
     and l.slot_key = p_slot_key and r.remarks like 'Skipped:%';

  select s.form_key into v_form from hr.clearance_slots s where s.slot_key = p_slot_key;
  perform hr.clearance_refresh_autoticks(p_case_id, v_form);
end;
$$;

-- =====================================================================
-- 5. REPLACED: case creation (HR-started cases begin as Submitted)
-- =====================================================================
create or replace function hr.create_clearance_case_internal(
  p_person_id         uuid,
  p_last_working_date date,
  p_actor             uuid,
  p_via               text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     record;
  v_id    uuid;
  v_today date;
begin
  select p.id, p.full_name, p.employee_code, p.designation, p.department_id, p.site_id,
         p.company_id, p.date_of_joining, p.personal_email, p.phone, p.address, p.status
    into v_p
    from public.persons p
   where p.id = p_person_id;

  if not found then
    raise exception 'Employee not found.';
  end if;
  if p_via = 'self' and v_p.status is distinct from 'Active' then
    raise exception 'Only an active employee can start a clearance.';
  end if;
  -- HR may record a clearance for someone already set to Inactive (a recent leaver)
  if p_via = 'hrbp' and v_p.status not in ('Active', 'Inactive') then
    raise exception 'A suspended employee cannot be cleared here. Ask HR.';
  end if;
  -- "today" in Pakistan time (the database clock is UTC)
  v_today := (now() at time zone 'Asia/Karachi')::date;
  if p_last_working_date is null then
    raise exception 'Please enter the last working date.';
  end if;
  if p_via = 'self' and p_last_working_date < v_today then
    raise exception 'The last working date must be today or later.';
  end if;
  if p_via = 'hrbp' and p_last_working_date < v_today - 30 then
    raise exception 'The last working date cannot be more than 30 days in the past.';
  end if;
  if p_last_working_date > v_today + 365 then
    raise exception 'The last working date is more than a year ahead. Please check it.';
  end if;

  if exists (select 1 from hr.clearance_cases c
              where c.person_id = p_person_id and c.status in ('Submitted', 'In Clearance')) then
    raise exception 'This employee already has an open offboarding request.';
  end if;

  -- Every case starts as Submitted. The HRBP then skips parts if needed and presses Forward.
  insert into hr.clearance_cases
    (person_id, employee_name, employee_code, designation, department_id, site_id, company_id,
     date_of_joining, contact_phone, contact_email, postal_address, last_working_date,
     raised_by_person_id, raised_via, status, employee_signed_at)
  values
    (v_p.id, v_p.full_name, v_p.employee_code, v_p.designation, v_p.department_id, v_p.site_id,
     v_p.company_id, v_p.date_of_joining, v_p.phone, v_p.personal_email, v_p.address,
     p_last_working_date, p_actor, p_via, 'Submitted',
     case when p_via = 'self' then now() end)
  returning id into v_id;

  insert into hr.clearance_responses (case_id, line_id)
  select v_id, l.id from hr.clearance_lines l where l.is_active;

  return v_id;
end;
$$;

-- =====================================================================
-- 6. REPLACED: forward (skipped parts do not need a signer)
-- =====================================================================
create or replace function hr.forward_clearance_case(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := public.current_person_id();
  v_case    record;
  v_missing text[];
begin
  if v_me is null or not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to forward requests.' using errcode = '42501';
  end if;

  select c.id, c.status, c.site_id, c.department_id
    into v_case
    from hr.clearance_cases c
   where c.id = p_case_id
   for update;

  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.status <> 'Submitted' then
    raise exception 'Only a Submitted request can be forwarded (this one is %).', v_case.status;
  end if;

  if v_case.site_id is null then
    raise exception 'This employee has no site set on their profile. Ask HR or Admin to set it first.';
  end if;
  if v_case.department_id is null and exists (
       select 1 from hr.clearance_slots s
        where s.is_active and s.scope = 'department'
          and not exists (select 1 from hr.clearance_skips k
                           where k.case_id = p_case_id and k.slot_key = s.slot_key)) then
    raise exception 'This employee has no department set on their profile. Ask HR or Admin to set it first.';
  end if;

  select coalesce(array_agg(m.label), '{}'::text[]) into v_missing
    from hr.clearance_missing_for_case(p_case_id) m;
  if array_length(v_missing, 1) is not null then
    raise exception 'No signer is set for: %. Set the signers for this site, or skip these parts for this request.',
      array_to_string(v_missing, ', ');
  end if;

  update hr.clearance_cases
     set status = 'In Clearance', hrbp_person_id = v_me, forwarded_at = now()
   where id = p_case_id;
end;
$$;

-- =====================================================================
-- 7. REPLACED: answer one line (skipped parts and the line-manager line are protected)
-- =====================================================================
create or replace function hr.set_clearance_response(
  p_case_id uuid,
  p_line_id uuid,
  p_outcome text,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_person_id();
  v_case   record;
  v_line   record;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('Yes', 'No', 'N/A') then
    raise exception 'The answer must be Yes, No or N/A.';
  end if;

  select c.id, c.status, c.person_id, c.line_manager_person_id into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.person_id = v_me then
    raise exception 'You cannot fill in or sign your own clearance.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'This request is not open for clearance (status: %).', v_case.status;
  end if;

  select l.slot_key, l.line_key, l.is_active, l.auto_from_form into v_line
    from hr.clearance_lines l where l.id = p_line_id;
  if not found or not v_line.is_active then
    raise exception 'Line not found.';
  end if;
  if v_line.auto_from_form is not null then
    raise exception 'This line fills in by itself when that form is signed.';
  end if;

  if not hr.is_clearance_signer(p_case_id, v_line.slot_key) then
    raise exception 'You are not a signer for this part of the form.' using errcode = '42501';
  end if;
  if exists (select 1 from hr.clearance_signoffs s
              where s.case_id = p_case_id and s.slot_key = v_line.slot_key) then
    raise exception 'This part has already been signed and is locked.';
  end if;
  if exists (select 1 from hr.clearance_skips k
              where k.case_id = p_case_id and k.slot_key = v_line.slot_key) then
    raise exception 'This part was skipped for this request.';
  end if;
  if v_line.line_key = 'p1.data_received' and v_case.line_manager_person_id is not null then
    raise exception 'This line is filled in when the line manager confirms. Change or clear the line manager first.';
  end if;

  -- upsert: a line HR added after the case started has no row yet
  insert into hr.clearance_responses (case_id, line_id, outcome, remarks, responded_by, responded_at)
  values (p_case_id, p_line_id, p_outcome, p_remarks, v_me, now())
  on conflict (case_id, line_id) do update
     set outcome = excluded.outcome, remarks = excluded.remarks,
         responded_by = excluded.responded_by, responded_at = excluded.responded_at;
end;
$$;

-- =====================================================================
-- 8. REPLACED: sign (skips, HR signs last, IT cannot sign with assets still assigned)
-- =====================================================================
create or replace function hr.sign_clearance(
  p_case_id  uuid,
  p_slot_key text,
  p_remarks  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_person_id();
  v_case   record;
  v_signer record;
  v_form   text;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  select c.id, c.status, c.person_id into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.person_id = v_me then
    raise exception 'You cannot fill in or sign your own clearance.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'This request is not open for clearance (status: %).', v_case.status;
  end if;

  if not hr.is_clearance_signer(p_case_id, p_slot_key) then
    raise exception 'You are not a signer for this part of the form.' using errcode = '42501';
  end if;
  if exists (select 1 from hr.clearance_signoffs s
              where s.case_id = p_case_id and s.slot_key = p_slot_key) then
    raise exception 'This part has already been signed.';
  end if;
  if exists (select 1 from hr.clearance_skips k
              where k.case_id = p_case_id and k.slot_key = p_slot_key) then
    raise exception 'This part was skipped for this request.';
  end if;

  -- HR (page one) signs last, after every other part is signed or skipped.
  if p_slot_key = 'hr' and exists (
       select 1 from hr.clearance_slots s
        where s.is_active and s.slot_key <> 'hr'
          and not exists (select 1 from hr.clearance_signoffs o
                           where o.case_id = p_case_id and o.slot_key = s.slot_key)
          and not exists (select 1 from hr.clearance_skips k
                           where k.case_id = p_case_id and k.slot_key = s.slot_key)) then
    raise exception 'HR signs last: the other signers have not all signed yet.';
  end if;

  -- IT: the inventory must be up to date first.
  if p_slot_key = 'it' and exists (
       select 1 from it.asset_assignments a
        where a.person_id = v_case.person_id and a.return_date is null) then
    raise exception 'This employee still holds IT assets. Return each one, or mark it Lost, before signing.';
  end if;

  -- Every line of this part must be answered first.
  if exists (
       select 1
         from hr.clearance_lines l
         left join hr.clearance_responses r on r.line_id = l.id and r.case_id = p_case_id
        where l.slot_key = p_slot_key and l.is_active and l.auto_from_form is null
          and r.outcome is null) then
    raise exception 'Please answer every line before signing.';
  end if;

  select p.full_name, p.designation into v_signer
    from public.persons p where p.id = v_me;

  insert into hr.clearance_signoffs
    (case_id, slot_key, signed_by_person_id, signer_name, signer_designation, remarks)
  values
    (p_case_id, p_slot_key, v_me, v_signer.full_name, v_signer.designation, p_remarks);

  -- tick that form on page one by itself once every part of it is signed or skipped
  select s.form_key into v_form from hr.clearance_slots s where s.slot_key = p_slot_key;
  perform hr.clearance_refresh_autoticks(p_case_id, v_form);

  if p_slot_key = 'hr' then
    update hr.clearance_cases
       set status = 'Completed', completed_at = now()
     where id = p_case_id;
  end if;
end;
$$;

-- =====================================================================
-- 9. (B) Line manager
-- =====================================================================
-- The HR signer picks (or clears) the line manager of this case.
create or replace function hr.set_clearance_line_manager(p_case_id uuid, p_manager_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_person_id();
  v_case record;
  v_mgr  record;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  select c.id, c.status, c.person_id, c.data_received_confirmed_at into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.person_id = v_me then
    raise exception 'You cannot change your own clearance.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'The line manager can only be set while the request is In Clearance (status: %).', v_case.status;
  end if;
  if not hr.is_clearance_signer(p_case_id, 'hr') then
    raise exception 'Only the HR signer for this case can set the line manager.' using errcode = '42501';
  end if;
  if v_case.data_received_confirmed_at is not null then
    raise exception 'The line manager has already confirmed, so it cannot be changed.';
  end if;

  if p_manager_person_id is not null then
    select p.full_name, p.status, p.person_type into v_mgr
      from public.persons p where p.id = p_manager_person_id;
    if not found then
      raise exception 'Line manager not found.';
    end if;
    if v_mgr.person_type is distinct from 'employee' or v_mgr.status is distinct from 'Active' then
      raise exception 'The line manager must be an active employee.';
    end if;
    if p_manager_person_id = v_case.person_id then
      raise exception 'The employee cannot be their own line manager.';
    end if;

    update hr.clearance_cases
       set line_manager_person_id = p_manager_person_id,
           reporting_manager_name = v_mgr.full_name
     where id = p_case_id;

    -- the "data received" tick now waits for the manager
    update hr.clearance_responses r
       set outcome = null, remarks = null, responded_by = null, responded_at = null
      from hr.clearance_lines l
     where r.line_id = l.id and r.case_id = p_case_id and l.line_key = 'p1.data_received';
  else
    update hr.clearance_cases set line_manager_person_id = null where id = p_case_id;
  end if;
end;
$$;

-- Search active employees to pick as line manager (people who may open the signer inbox).
create or replace function hr.clearance_search_managers(p_query text, p_limit integer default 20)
returns table (
  person_id      uuid,
  full_name      text,
  employee_code  text,
  designation    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.sign') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation
      from public.persons p
     where p.person_type = 'employee'
       and p.status = 'Active'
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- What a line manager sees: only the requests that name them (no other case data).
create or replace function hr.my_handover_requests()
returns table (
  case_id            uuid,
  case_number        text,
  employee_name      text,
  employee_code      text,
  designation        text,
  last_working_date  date,
  case_status        text,
  confirmed_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  return query
    select c.id, c.case_number, c.employee_name, c.employee_code, c.designation,
           c.last_working_date, c.status, c.data_received_confirmed_at
      from hr.clearance_cases c
     where c.line_manager_person_id = v_me
       and c.status in ('In Clearance', 'Completed')
     order by (c.data_received_confirmed_at is not null), c.last_working_date
     limit 50;
end;
$$;

-- The line manager confirms they received the employee's data.
create or replace function hr.confirm_data_received(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_person_id();
  v_case record;
  v_name text;
  v_line uuid;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  select c.id, c.status, c.line_manager_person_id, c.data_received_confirmed_at into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.line_manager_person_id is distinct from v_me then
    raise exception 'You are not the line manager for this request.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'This request is not open (status: %).', v_case.status;
  end if;
  if v_case.data_received_confirmed_at is not null then
    raise exception 'You have already confirmed this.';
  end if;

  select p.full_name into v_name from public.persons p where p.id = v_me;

  update hr.clearance_cases
     set data_received_confirmed_by = v_me, data_received_confirmed_at = now()
   where id = p_case_id;

  select l.id into v_line
    from hr.clearance_lines l
   where l.line_key = 'p1.data_received' and l.is_active;

  if v_line is not null then
    insert into hr.clearance_responses (case_id, line_id, outcome, remarks, responded_by, responded_at)
    values (p_case_id, v_line, 'Yes',
            'Confirmed by ' || coalesce(v_name, 'the line manager') || ' on '
              || to_char(now() at time zone 'Asia/Karachi', 'DD Mon YYYY'),
            v_me, now())
    on conflict (case_id, line_id) do update
       set outcome = 'Yes', remarks = excluded.remarks,
           responded_by = excluded.responded_by, responded_at = excluded.responded_at;
  end if;
end;
$$;

-- =====================================================================
-- 10. (C) IT assets from the clearance form
-- =====================================================================
-- The assets the employee still holds. For the IT signer of the case (and read_all), so the IT
-- Team Lead does not need the inventory permissions.
create or replace function hr.clearance_list_open_assets(p_case_id uuid)
returns table (
  assignment_id       uuid,
  asset_id            uuid,
  asset_tag           text,
  asset_name          text,
  serial_number       text,
  assigned_date       date,
  assigned_condition  text,
  asset_status        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  select c.person_id into v_person from hr.clearance_cases c where c.id = p_case_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if not (public.has_permission('hr.clearance.read_all')
          or hr.is_clearance_signer(p_case_id, 'it')) then
    raise exception 'You are not allowed to see these assets.' using errcode = '42501';
  end if;

  return query
    select a.id, a.asset_id, s.asset_tag, s.asset_name, s.serial_number,
           a.assigned_date, a.assigned_condition, s.status
      from it.asset_assignments a
      join it.assets s on s.id = a.asset_id
     where a.person_id = v_person and a.return_date is null
     order by a.assigned_date, s.asset_tag;
end;
$$;

-- The IT signer marks one asset as received back (or Lost). The inventory changes at once.
create or replace function hr.clearance_return_asset(
  p_case_id            uuid,
  p_assignment_id      uuid,
  p_returned_condition text default null,
  p_new_status         text default 'Unassigned',
  p_remarks            text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me           uuid := public.current_person_id();
  v_case         record;
  v_a            record;
  v_asset_status text;
  v_today        date := (now() at time zone 'Asia/Karachi')::date;
  v_note         text;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;
  if p_new_status is null or p_new_status not in ('Unassigned', 'Retired', 'Lost') then
    raise exception 'After a return the asset status must be Unassigned, Retired or Lost.';
  end if;

  select c.id, c.status, c.person_id, c.case_number into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.person_id = v_me then
    raise exception 'You cannot fill in or sign your own clearance.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'This request is not open for clearance (status: %).', v_case.status;
  end if;
  if not hr.is_clearance_signer(p_case_id, 'it') then
    raise exception 'Only the IT signer for this case can return assets here.' using errcode = '42501';
  end if;
  if exists (select 1 from hr.clearance_signoffs o
              where o.case_id = p_case_id and o.slot_key = 'it') then
    raise exception 'The IT part has already been signed and is locked.';
  end if;
  if exists (select 1 from hr.clearance_skips k
              where k.case_id = p_case_id and k.slot_key = 'it') then
    raise exception 'The IT part was skipped for this request.';
  end if;

  select a.id, a.asset_id, a.person_id, a.return_date, a.assigned_date into v_a
    from it.asset_assignments a where a.id = p_assignment_id for update;
  if not found or v_a.person_id <> v_case.person_id or v_a.return_date is not null then
    raise exception 'This asset is not assigned to this employee, or it was already returned.';
  end if;

  select s.status into v_asset_status from it.assets s where s.id = v_a.asset_id for update;
  if v_asset_status = 'In Repair' then
    raise exception 'This asset is in repair. Close the repair in IT Inventory first.';
  end if;

  v_note := case when p_new_status = 'Lost'
                 then 'Not returned: marked Lost in offboarding clearance '
                 else 'Returned in offboarding clearance ' end
            || v_case.case_number
            || coalesce(': ' || nullif(btrim(p_remarks), ''), '');

  update it.asset_assignments
     set return_date           = greatest(v_a.assigned_date, v_today),
         returned_condition    = nullif(btrim(p_returned_condition), ''),
         returned_to_person_id = v_me,
         status                = 'Returned',
         remarks               = v_note,
         updated_by            = v_me
   where id = v_a.id;

  update it.assets
     set status     = p_new_status,
         condition  = coalesce(nullif(btrim(p_returned_condition), ''), condition),
         updated_by = v_me
   where id = v_a.asset_id;
end;
$$;

-- =====================================================================
-- 11. Who may call what
-- =====================================================================
revoke all on function hr.clearance_refresh_autoticks(uuid, text) from public, anon, authenticated;
grant execute on function hr.clearance_refresh_autoticks(uuid, text) to service_role;

revoke all on function hr.clearance_missing_for_case(uuid)                              from public, anon;
revoke all on function hr.skip_clearance_slot(uuid, text, text)                         from public, anon;
revoke all on function hr.unskip_clearance_slot(uuid, text)                             from public, anon;
revoke all on function hr.set_clearance_line_manager(uuid, uuid)                        from public, anon;
revoke all on function hr.clearance_search_managers(text, integer)                      from public, anon;
revoke all on function hr.my_handover_requests()                                        from public, anon;
revoke all on function hr.confirm_data_received(uuid)                                   from public, anon;
revoke all on function hr.clearance_list_open_assets(uuid)                              from public, anon;
revoke all on function hr.clearance_return_asset(uuid, uuid, text, text, text)          from public, anon;

grant execute on function hr.clearance_missing_for_case(uuid)                           to authenticated, service_role;
grant execute on function hr.skip_clearance_slot(uuid, text, text)                      to authenticated, service_role;
grant execute on function hr.unskip_clearance_slot(uuid, text)                          to authenticated, service_role;
grant execute on function hr.set_clearance_line_manager(uuid, uuid)                     to authenticated, service_role;
grant execute on function hr.clearance_search_managers(text, integer)                   to authenticated, service_role;
grant execute on function hr.my_handover_requests()                                     to authenticated, service_role;
grant execute on function hr.confirm_data_received(uuid)                                to authenticated, service_role;
grant execute on function hr.clearance_list_open_assets(uuid)                           to authenticated, service_role;
grant execute on function hr.clearance_return_asset(uuid, uuid, text, text, text)       to authenticated, service_role;

commit;
