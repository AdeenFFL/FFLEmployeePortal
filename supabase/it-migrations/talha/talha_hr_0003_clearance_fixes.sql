-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding clearance - fixes found in the review of talha_hr_0001
-- Depends on:  talha_hr_0001_clearance_system.sql and talha_hr_0002 (both live).
-- Applied to live DB: YES (2026-11-13, by Talha)
--
-- WHAT THIS CHANGES (functions are replaced in place; tables and data are not touched):
--   N2  page-one tick for Admin / Accounts / IT shows "No" when that form has a "No" answer
--   N3  HRBP can record a clearance for an employee already set to Inactive (recent leaver)
--   N4  the employee who is leaving cannot fill in or sign their own clearance
--   N6  a form line can no longer change form / slot once answers exist, and its form must
--       match its signature slot (deactivate it and add a new line instead)
--   N7  the last working date cannot be more than a year ahead
-- NOT changed on purpose: N5 (sign and print are enforced by the signers table and the app).
--
-- Safe to undo: re-run the three functions exactly as they are in talha_hr_0001
--   (hr.create_clearance_case_internal, hr.set_clearance_response, hr.sign_clearance), then:
--   drop trigger trg_clearance_line_check on hr.clearance_lines;
--   drop function hr.clearance_line_check();

begin;

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
  v_p       record;
  v_id      uuid;
  v_missing text[];
  v_today   date;
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

  if p_via = 'hrbp' then
    perform hr.clearance_check_ready(v_p.site_id, v_p.department_id);
  end if;

  insert into hr.clearance_cases
    (person_id, employee_name, employee_code, designation, department_id, site_id, company_id,
     date_of_joining, contact_phone, contact_email, postal_address, last_working_date,
     raised_by_person_id, raised_via, status, hrbp_person_id, forwarded_at, employee_signed_at)
  values
    (v_p.id, v_p.full_name, v_p.employee_code, v_p.designation, v_p.department_id, v_p.site_id,
     v_p.company_id, v_p.date_of_joining, v_p.phone, v_p.personal_email, v_p.address,
     p_last_working_date, p_actor, p_via,
     case when p_via = 'hrbp' then 'In Clearance' else 'Submitted' end,
     case when p_via = 'hrbp' then p_actor end,
     case when p_via = 'hrbp' then now() end,
     case when p_via = 'self' then now() end)
  returning id into v_id;

  insert into hr.clearance_responses (case_id, line_id)
  select v_id, l.id from hr.clearance_lines l where l.is_active;

  return v_id;
end;
$$;

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

  select l.slot_key, l.is_active, l.auto_from_form into v_line
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

  -- upsert: a line HR added after the case started has no row yet
  insert into hr.clearance_responses (case_id, line_id, outcome, remarks, responded_by, responded_at)
  values (p_case_id, p_line_id, p_outcome, p_remarks, v_me, now())
  on conflict (case_id, line_id) do update
     set outcome = excluded.outcome, remarks = excluded.remarks,
         responded_by = excluded.responded_by, responded_at = excluded.responded_at;
end;
$$;

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
  v_signer  record;
  v_form    text;
  v_outcome text;
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

  -- HR (page one) signs last, after every other signer.
  if p_slot_key = 'hr' and exists (
       select 1 from hr.clearance_slots s
        where s.is_active and s.slot_key <> 'hr'
          and not exists (select 1 from hr.clearance_signoffs o
                           where o.case_id = p_case_id and o.slot_key = s.slot_key)) then
    raise exception 'HR signs last: the other signers have not all signed yet.';
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

  -- When every signer of a form has signed, tick that form on page one by itself.
  select s.form_key into v_form from hr.clearance_slots s where s.slot_key = p_slot_key;
  if v_form in ('admin', 'accounts', 'it')
     and not exists (
       select 1 from hr.clearance_slots s
        where s.is_active and s.form_key = v_form
          and not exists (select 1 from hr.clearance_signoffs o
                           where o.case_id = p_case_id and o.slot_key = s.slot_key)) then
    -- the page-one tick says "Yes" only if the form has no "No" answer
    select case when exists (
                   select 1
                     from hr.clearance_responses r
                     join hr.clearance_lines l2 on l2.id = r.line_id
                    where r.case_id = p_case_id and l2.form_key = v_form
                      and l2.is_active and l2.auto_from_form is null
                      and r.outcome = 'No')
                then 'No' else 'Yes' end
      into v_outcome;

    insert into hr.clearance_responses (case_id, line_id, outcome, responded_at)
    select p_case_id, l.id, v_outcome, now()
      from hr.clearance_lines l
     where l.is_active and l.auto_from_form = v_form
    on conflict (case_id, line_id) do update
       set outcome = excluded.outcome, responded_at = excluded.responded_at;
  end if;

  if p_slot_key = 'hr' then
    update hr.clearance_cases
       set status = 'Completed', completed_at = now()
     where id = p_case_id;
  end if;
end;
$$;

-- N6: keep form lines consistent
create or replace function hr.clearance_line_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form text;
begin
  select s.form_key into v_form from hr.clearance_slots s where s.slot_key = new.slot_key;
  if v_form is distinct from new.form_key then
    raise exception 'The line''s form (%) must match its signature slot''s form (%).', new.form_key, v_form;
  end if;

  if tg_op = 'UPDATE'
     and (new.slot_key is distinct from old.slot_key
          or new.form_key is distinct from old.form_key
          or new.auto_from_form is distinct from old.auto_from_form)
     and exists (select 1 from hr.clearance_responses r where r.line_id = old.id) then
    raise exception 'This line is already used in a clearance. Deactivate it and add a new line instead.';
  end if;

  return new;
end;
$$;

create trigger trg_clearance_line_check
  before insert or update on hr.clearance_lines
  for each row execute function hr.clearance_line_check();

commit;
