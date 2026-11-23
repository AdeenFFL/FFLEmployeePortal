-- talha_hr_0013: two more page-one details the HR signer fills in (form HR/002):
--   "Handing over done to Mr. / Ms." and "Email forwarding to".
-- Depends on talha_hr_0007 (hr.clearance_hr_details, hr.save_clearance_details).
--
-- The save function gets two new parameters, so the old signature is dropped and the function is
-- created again with the same checks plus the two new fields.

begin;

alter table hr.clearance_hr_details
  add column handing_over_to  text,
  add column email_forward_to text,
  add constraint clearance_hr_details_handing_over_to_len
    check (handing_over_to  is null or length(handing_over_to)  <= 200),
  add constraint clearance_hr_details_email_forward_to_len
    check (email_forward_to is null or length(email_forward_to) <= 200);

drop function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
                                        integer, numeric, numeric, numeric, numeric, text);

create function hr.save_clearance_details(
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
  p_other_outstanding          text,
  p_handing_over_to            text,
  p_email_forward_to           text
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
     or length(coalesce(p_reporting_manager_name, '')) > 200
     or length(coalesce(p_handing_over_to, '')) > 200
     or length(coalesce(p_email_forward_to, '')) > 200 then
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
     other_outstanding, handing_over_to, email_forward_to, updated_by)
  values
    (p_case_id, p_resignation_letter_date, p_resignation_effective_from, p_unserved_notice_days,
     p_overtime_single, p_overtime_double, p_overtime_triple, p_annual_leave_balance,
     nullif(btrim(p_other_outstanding), ''), nullif(btrim(p_handing_over_to), ''),
     nullif(btrim(p_email_forward_to), ''), v_me)
  on conflict (case_id) do update
     set resignation_letter_date    = excluded.resignation_letter_date,
         resignation_effective_from = excluded.resignation_effective_from,
         unserved_notice_days       = excluded.unserved_notice_days,
         overtime_single            = excluded.overtime_single,
         overtime_double            = excluded.overtime_double,
         overtime_triple            = excluded.overtime_triple,
         annual_leave_balance       = excluded.annual_leave_balance,
         other_outstanding          = excluded.other_outstanding,
         handing_over_to            = excluded.handing_over_to,
         email_forward_to           = excluded.email_forward_to,
         updated_by                 = excluded.updated_by;
end;
$$;

revoke all on function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
                                                 integer, numeric, numeric, numeric, numeric, text,
                                                 text, text)
  from public, anon;
grant execute on function hr.save_clearance_details(uuid, text, text, text, text, date, date, date, date,
                                                    integer, numeric, numeric, numeric, numeric, text,
                                                    text, text)
  to authenticated, service_role;

commit;
