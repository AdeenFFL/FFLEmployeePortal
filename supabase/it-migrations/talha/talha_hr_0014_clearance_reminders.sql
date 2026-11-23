-- talha_hr_0014: reminders for clearance parts that wait too long.
-- Depends on talha_hr_0001 (hr.clearance_*), talha_hr_0012 (signers notified on forward) and
-- 0029 (it.notify).
--
-- A daily sweep finds every request In Clearance that was forwarded more than 3 days ago and every
-- part still not signed or skipped, and reminds that part's signers in the portal (bell) and by
-- email (the email goes out with the next portal save, like the other IT reminders). Each part is
-- reminded at most once every 3 days. HR (page one) signs last, so HR is only reminded once all the
-- other parts are signed or skipped.
--
-- After applying this file, schedule it once (Database -> Extensions -> pg_cron must be on):
--   select cron.schedule('hr-clearance-reminders', '0 9 * * *',
--                        $$select hr.clearance_reminder_sweep()$$);
-- To stop it:  select cron.unschedule('hr-clearance-reminders');

begin;

-- When each part of each request was last reminded (written only by the sweep below).
create table hr.clearance_reminders (
  case_id      uuid not null references hr.clearance_cases (id) on delete cascade,
  slot_key     text not null,
  last_sent_at timestamptz not null default now(),
  primary key (case_id, slot_key)
);

grant select, insert, update, delete on hr.clearance_reminders to service_role;
revoke all on hr.clearance_reminders from anon, authenticated;
alter table hr.clearance_reminders enable row level security;

create or replace function hr.clearance_reminder_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_gap     constant interval := interval '3 days';
  v_case    record;
  v_slot    record;
  v_signer  record;
  v_days    integer;
  v_sent    integer := 0;
  v_any     boolean;
begin
  for v_case in
    select c.id, c.case_number, c.employee_name, c.person_id, c.site_id, c.department_id,
           c.forwarded_at
      from hr.clearance_cases c
     where c.status = 'In Clearance'
       and c.forwarded_at is not null
       and c.forwarded_at < now() - c_gap
  loop
    v_days := greatest(1, (now()::date - v_case.forwarded_at::date));

    for v_slot in
      select s.slot_key, s.label, s.scope
        from hr.clearance_slots s
       where s.is_active
         and not exists (select 1 from hr.clearance_signoffs o
                          where o.case_id = v_case.id and o.slot_key = s.slot_key)
         and not exists (select 1 from hr.clearance_skips k
                          where k.case_id = v_case.id and k.slot_key = s.slot_key)
       order by s.sort_order
    loop
      -- HR signs last: no reminder while another part is still open.
      if v_slot.slot_key = 'hr' and exists (
        select 1 from hr.clearance_slots s2
         where s2.is_active and s2.slot_key <> 'hr'
           and not exists (select 1 from hr.clearance_signoffs o
                            where o.case_id = v_case.id and o.slot_key = s2.slot_key)
           and not exists (select 1 from hr.clearance_skips k
                            where k.case_id = v_case.id and k.slot_key = s2.slot_key)
      ) then
        continue;
      end if;

      -- At most once every 3 days per part.
      if exists (select 1 from hr.clearance_reminders r
                  where r.case_id = v_case.id and r.slot_key = v_slot.slot_key
                    and r.last_sent_at > now() - c_gap) then
        continue;
      end if;

      v_any := false;
      for v_signer in
        select distinct g.person_id
          from hr.clearance_signers g
         where g.slot_key = v_slot.slot_key
           and ((v_slot.scope = 'site'       and g.site_id       = v_case.site_id)
             or (v_slot.scope = 'department' and g.department_id = v_case.department_id))
           and g.person_id is distinct from v_case.person_id
      loop
        perform it.notify(
          v_signer.person_id,
          'clearance_reminder',
          format('Reminder: clearance to sign: %s', v_slot.label),
          format('%s · %s · waiting %s day%s', v_case.case_number, v_case.employee_name,
                 v_days, case when v_days = 1 then '' else 's' end),
          format('/hr/clearance/%s/%s', v_case.id, v_slot.slot_key)
        );
        v_sent := v_sent + 1;
        v_any := true;
      end loop;

      if v_any then
        insert into hr.clearance_reminders (case_id, slot_key, last_sent_at)
        values (v_case.id, v_slot.slot_key, now())
        on conflict (case_id, slot_key) do update set last_sent_at = excluded.last_sent_at;
      end if;
    end loop;
  end loop;

  return v_sent;
end;
$$;

revoke all on function hr.clearance_reminder_sweep() from public, anon, authenticated;
grant execute on function hr.clearance_reminder_sweep() to service_role;

commit;
