-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Clearance form page one - details the HR signer fills in the system
-- Depends on:  talha_hr_0001 .. 0006 (live): hr.clearance_cases, hr.is_clearance_signer(),
--              public.has_permission(), public.current_person_id(), public.set_updated_at().
-- Applied to live DB: YES (2026-11-18, by Talha)
--
-- WHAT THIS ADDS
--   * hr.clearance_hr_details: one row per case with the SENSITIVE page-one details
--       resignation letter date, effective-from date, un-served notice days,
--       overtime (single / double / triple), un-availed annual leave balance, other outstanding.
--     Only HR/HRBP/Admin (hr.clearance.read_all) and the HR signer of the case can read it.
--     The employee and the other signers (Admin, Store, Accounts, IT) cannot.
--   * hr.save_clearance_details(...): the ONLY way to write it. It also updates the contact
--     fields kept on the case (phone, email, postal address, reporting manager, date of joining,
--     last working date). Only the HR signer of that case can call it, while the case is
--     In Clearance (HR signs last, so this closes when HR signs).
--
-- The three page-one lines "Handing over done to", "Complete Data received by Line Manager" and
-- "Email forwarding to" are NOT here: HR answers them as normal checklist lines (answer + remarks).
--
-- Safe to undo (new objects only):
--   drop function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
--                                           integer, numeric, numeric, numeric, numeric, text);
--   drop table hr.clearance_hr_details;

begin;

create table hr.clearance_hr_details (
  case_id                     uuid primary key references hr.clearance_cases (id) on delete cascade,
  resignation_letter_date     date,
  resignation_effective_from  date,
  unserved_notice_days        integer,
  overtime_single             numeric(7,2),
  overtime_double             numeric(7,2),
  overtime_triple             numeric(7,2),
  annual_leave_balance        numeric(7,2),
  other_outstanding           text,
  updated_by                  uuid references public.persons (id) on delete set null,
  updated_at                  timestamptz not null default now(),
  check (unserved_notice_days is null or unserved_notice_days between 0 and 365),
  check (overtime_single      is null or overtime_single      >= 0),
  check (overtime_double      is null or overtime_double      >= 0),
  check (overtime_triple      is null or overtime_triple      >= 0),
  check (annual_leave_balance is null or annual_leave_balance >= 0),
  check (other_outstanding    is null or length(other_outstanding) <= 500)
);

create trigger trg_clearance_hr_details_updated_at
  before update on hr.clearance_hr_details
  for each row execute function public.set_updated_at();

-- ---------- security: read-only for people, written only by the function below ----------
grant select on hr.clearance_hr_details to authenticated;
grant select, insert, update, delete on hr.clearance_hr_details to service_role;
revoke insert, update, delete on hr.clearance_hr_details from authenticated;

alter table hr.clearance_hr_details enable row level security;

create policy "hr details readable by HR roles or the HR signer"
  on hr.clearance_hr_details for select to authenticated
  using (public.has_permission('hr.clearance.read_all')
         or hr.is_clearance_signer(case_id, 'hr'));

-- ---------- the writer ----------
create or replace function hr.save_clearance_details(
  p_case_id                    uuid,
  p_contact_phone              text,
  p_contact_email              text,
  p_postal_address             text,
  p_reporting_manager_name     text,
  p_date_of_joining            date,
  p_last_working_date          date,
  p_resignation_letter_date    date,
  p_resignation_effective_from date,
  p_unserved_notice_days       integer,
  p_overtime_single            numeric,
  p_overtime_double            numeric,
  p_overtime_triple            numeric,
  p_annual_leave_balance       numeric,
  p_other_outstanding          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_person_id();
  v_case  record;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  select c.id, c.status, c.person_id, c.created_at
    into v_case
    from hr.clearance_cases c
   where c.id = p_case_id
   for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.person_id = v_me then
    raise exception 'You cannot fill in your own clearance.' using errcode = '42501';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'These details can only be changed while the request is In Clearance (status: %).', v_case.status;
  end if;
  if not hr.is_clearance_signer(p_case_id, 'hr') then
    raise exception 'Only the HR signer for this case can fill in these details.' using errcode = '42501';
  end if;

  if p_last_working_date is null then
    raise exception 'The last working date cannot be empty.';
  end if;
  if p_last_working_date < (v_case.created_at at time zone 'Asia/Karachi')::date - 30
     or p_last_working_date > v_today + 365 then
    raise exception 'The last working date looks wrong. Please check it.';
  end if;
  if p_date_of_joining is not null and p_date_of_joining > v_today then
    raise exception 'The date of joining cannot be in the future.';
  end if;
  if p_unserved_notice_days is not null and p_unserved_notice_days not between 0 and 365 then
    raise exception 'Un-served notice days must be between 0 and 365.';
  end if;
  if coalesce(p_overtime_single, 0) < 0 or coalesce(p_overtime_double, 0) < 0
     or coalesce(p_overtime_triple, 0) < 0 or coalesce(p_annual_leave_balance, 0) < 0 then
    raise exception 'Overtime hours and the leave balance cannot be negative.';
  end if;
  if length(coalesce(p_other_outstanding, '')) > 500
     or length(coalesce(p_postal_address, '')) > 500
     or length(coalesce(p_contact_phone, '')) > 100
     or length(coalesce(p_contact_email, '')) > 200
     or length(coalesce(p_reporting_manager_name, '')) > 200 then
    raise exception 'One of the text fields is too long.';
  end if;

  update hr.clearance_cases
     set contact_phone          = nullif(btrim(p_contact_phone), ''),
         contact_email          = nullif(btrim(p_contact_email), ''),
         postal_address         = nullif(btrim(p_postal_address), ''),
         reporting_manager_name = nullif(btrim(p_reporting_manager_name), ''),
         date_of_joining        = p_date_of_joining,
         last_working_date      = p_last_working_date
   where id = p_case_id;

  insert into hr.clearance_hr_details
    (case_id, resignation_letter_date, resignation_effective_from, unserved_notice_days,
     overtime_single, overtime_double, overtime_triple, annual_leave_balance,
     other_outstanding, updated_by)
  values
    (p_case_id, p_resignation_letter_date, p_resignation_effective_from, p_unserved_notice_days,
     p_overtime_single, p_overtime_double, p_overtime_triple, p_annual_leave_balance,
     nullif(btrim(p_other_outstanding), ''), v_me)
  on conflict (case_id) do update
     set resignation_letter_date    = excluded.resignation_letter_date,
         resignation_effective_from = excluded.resignation_effective_from,
         unserved_notice_days       = excluded.unserved_notice_days,
         overtime_single            = excluded.overtime_single,
         overtime_double            = excluded.overtime_double,
         overtime_triple            = excluded.overtime_triple,
         annual_leave_balance       = excluded.annual_leave_balance,
         other_outstanding          = excluded.other_outstanding,
         updated_by                 = excluded.updated_by;
end;
$$;

revoke all on function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
                                                 integer, numeric, numeric, numeric, numeric, text)
  from public, anon;
grant execute on function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
                                                    integer, numeric, numeric, numeric, numeric, text)
  to authenticated, service_role;

commit;
