-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding clearance - (A) email the signers when a case starts, (B) email the line
--              manager when chosen, (C) the IT Team Lead hands asset returns to IT staff
-- Depends on:  talha_hr_0001 .. 0011 (live), it.notify (migration 0029: in-app + email queue)
-- Applied to live DB: YES (2026-11-20, by Talha)
--
-- (A) When a case becomes In Clearance (the HRBP forwards it), every signer of every active part
--     that is NOT skipped gets an in-app notification + email with a link to their part.
-- (B) When HR chooses (or changes) the line manager, that person gets a notification + email:
--     confirm "Complete data received" on My Requests.
--     A and B are one trigger on hr.clearance_cases; forward_clearance_case and
--     set_clearance_line_manager are not changed. it.notify never notifies the person doing the
--     action, so e.g. an HRBP who is also a signer gets no email for their own forward.
-- (C) Per asset: the IT Team Lead can hand "return this asset" to an IT staff member (same IT
--     staff rule as talha_hr_0011). The assignee is notified, sees the asset on My clearance tasks
--     and returns it (or marks it Lost) there. The IT part still cannot be signed while an asset
--     is held.
--
-- NEW:      hr.clearance_notify_on_case_change (trigger), hr.clearance_asset_tasks,
--           hr.assign_clearance_asset, hr.my_clearance_asset_tasks
-- REPLACED: hr.clearance_return_asset (same arguments): the assignee of that asset may now return
--           it too. Its previous version is in talha_hr_0008.
--
-- Safe to undo: re-run hr.clearance_return_asset as it is in talha_hr_0008, then:
--   drop trigger trg_clearance_notify_on_case_change on hr.clearance_cases;
--   drop function hr.clearance_notify_on_case_change();
--   drop function hr.my_clearance_asset_tasks();
--   drop function hr.assign_clearance_asset(uuid, uuid, uuid);
--   drop table hr.clearance_asset_tasks;

begin;

-- =====================================================================
-- 1. (A) + (B): notifications when a case starts or a line manager is chosen
-- =====================================================================
create or replace function hr.clearance_notify_on_case_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signer  record;
  v_body    text := format('%s · %s · last working date %s',
                           new.case_number, new.employee_name,
                           to_char(new.last_working_date, 'DD Mon YYYY'));
begin
  -- (A) the case just entered clearance: every signer of every part still expected
  if new.status = 'In Clearance' and old.status is distinct from 'In Clearance' then
    for v_signer in
      select distinct g.person_id, s.slot_key, s.label, s.sort_order
        from hr.clearance_slots s
        join hr.clearance_signers g on g.slot_key = s.slot_key
       where s.is_active
         and ((s.scope = 'site'       and g.site_id       = new.site_id)
           or (s.scope = 'department' and g.department_id = new.department_id))
         and g.person_id is distinct from new.person_id
         and not exists (select 1 from hr.clearance_skips k
                          where k.case_id = new.id and k.slot_key = s.slot_key)
       order by s.sort_order
    loop
      perform it.notify(
        v_signer.person_id,
        'clearance_to_sign',
        format('Clearance to sign: %s', v_signer.label),
        v_body,
        format('/hr/clearance/%s/%s', new.id, v_signer.slot_key)
      );
    end loop;
  end if;

  -- (B) a (new) line manager was chosen while the case is open
  if new.line_manager_person_id is not null
     and new.line_manager_person_id is distinct from old.line_manager_person_id
     and new.status = 'In Clearance' then
    perform it.notify(
      new.line_manager_person_id,
      'clearance_handover_confirm',
      format('Please confirm the handover of %s', new.employee_name),
      v_body || ' · HR chose you as the line manager. Confirm once you have received their complete data.',
      '/requests'
    );
  end if;

  return null;
end;
$$;

revoke all on function hr.clearance_notify_on_case_change() from public, anon, authenticated;

create trigger trg_clearance_notify_on_case_change
  after update of status, line_manager_person_id on hr.clearance_cases
  for each row execute function hr.clearance_notify_on_case_change();

-- =====================================================================
-- 2. (C) Which open asset of the leaving employee was handed to whom
-- =====================================================================
create table hr.clearance_asset_tasks (
  case_id              uuid not null references hr.clearance_cases (id) on delete cascade,
  asset_assignment_id  uuid not null references it.asset_assignments (id) on delete cascade,
  assignee_person_id   uuid not null references public.persons (id) on delete cascade,
  assignee_name        text not null,
  assigned_by          uuid references public.persons (id) on delete set null,
  assigned_by_name     text,
  assigned_at          timestamptz not null default now(),
  primary key (case_id, asset_assignment_id)
);

create index idx_clearance_asset_tasks_assignee
  on hr.clearance_asset_tasks (assignee_person_id);

grant select on hr.clearance_asset_tasks to authenticated;
grant select, insert, update, delete on hr.clearance_asset_tasks to service_role;
revoke insert, update, delete on hr.clearance_asset_tasks from authenticated;

alter table hr.clearance_asset_tasks enable row level security;

create policy "asset tasks readable with the case or by the assignee"
  on hr.clearance_asset_tasks for select to authenticated
  using (
    assignee_person_id = public.current_person_id()
    or exists (select 1 from hr.clearance_cases c where c.id = clearance_asset_tasks.case_id)
  );

-- Assign / reassign / take back (null) one asset return. IT signer of the case only.
create or replace function hr.assign_clearance_asset(
  p_case_id        uuid,
  p_assignment_id  uuid,
  p_person_id      uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me        uuid := public.current_person_id();
  v_me_name   text;
  v_case      record;
  v_a         record;
  v_name      text;
  v_previous  uuid;
begin
  if v_me is null then
    raise exception 'You must be logged in.' using errcode = '42501';
  end if;

  select c.id, c.status, c.person_id, c.case_number, c.employee_name, c.last_working_date
    into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_case.status <> 'In Clearance' then
    raise exception 'This request is not open for clearance (status: %).', v_case.status;
  end if;
  if not hr.is_clearance_signer(p_case_id, 'it') then
    raise exception 'Only the IT signer for this case can assign asset returns.' using errcode = '42501';
  end if;
  if exists (select 1 from hr.clearance_signoffs o
              where o.case_id = p_case_id and o.slot_key = 'it') then
    raise exception 'The IT part has already been signed and is locked.';
  end if;
  if exists (select 1 from hr.clearance_skips k
              where k.case_id = p_case_id and k.slot_key = 'it') then
    raise exception 'The IT part was skipped for this request.';
  end if;

  select a.id, a.person_id, a.return_date, s.asset_tag, s.asset_name into v_a
    from it.asset_assignments a
    join it.assets s on s.id = a.asset_id
   where a.id = p_assignment_id;
  if not found or v_a.person_id is distinct from v_case.person_id or v_a.return_date is not null then
    raise exception 'This asset is not assigned to this employee, or it was already returned.';
  end if;

  select t.assignee_person_id into v_previous
    from hr.clearance_asset_tasks t
   where t.case_id = p_case_id and t.asset_assignment_id = p_assignment_id;

  if p_person_id is null then
    delete from hr.clearance_asset_tasks
     where case_id = p_case_id and asset_assignment_id = p_assignment_id;
    return;
  end if;

  if p_person_id = v_case.person_id then
    raise exception 'The leaving employee cannot return their own assets here.';
  end if;
  if not hr.clearance_is_it_staff(p_person_id) then
    raise exception 'Choose an active IT staff member.';
  end if;

  select p.full_name into v_name from public.persons p where p.id = p_person_id;
  select p.full_name into v_me_name from public.persons p where p.id = v_me;

  insert into hr.clearance_asset_tasks
    (case_id, asset_assignment_id, assignee_person_id, assignee_name, assigned_by, assigned_by_name, assigned_at)
  values (p_case_id, p_assignment_id, p_person_id, v_name, v_me, v_me_name, now())
  on conflict (case_id, asset_assignment_id) do update
     set assignee_person_id = excluded.assignee_person_id,
         assignee_name      = excluded.assignee_name,
         assigned_by        = excluded.assigned_by,
         assigned_by_name   = excluded.assigned_by_name,
         assigned_at        = excluded.assigned_at;

  if v_previous is distinct from p_person_id then
    perform it.notify(
      p_person_id,
      'clearance_asset_task_assigned',
      format('Asset return: %s %s', v_a.asset_tag, v_a.asset_name),
      format('%s · collect it from %s · last working date %s · assigned by %s',
             v_case.case_number, v_case.employee_name,
             to_char(v_case.last_working_date, 'DD Mon YYYY'), coalesce(v_me_name, '—')),
      '/hr/clearance/tasks'
    );
  end if;
end;
$$;

-- What an assignee sees: only the assets handed to them.
create or replace function hr.my_clearance_asset_tasks()
returns table (
  case_id              uuid,
  case_number          text,
  employee_name        text,
  employee_code        text,
  last_working_date    date,
  case_status          text,
  part_locked          boolean,
  assignment_id        uuid,
  asset_tag            text,
  asset_name           text,
  serial_number        text,
  assigned_date        date,
  assigned_condition   text,
  asset_status         text,
  returned             boolean,
  return_date          date,
  assigned_by_name     text,
  assigned_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.case_number, c.employee_name, c.employee_code, c.last_working_date, c.status,
         (exists (select 1 from hr.clearance_signoffs o
                   where o.case_id = c.id and o.slot_key = 'it')
          or exists (select 1 from hr.clearance_skips k
                      where k.case_id = c.id and k.slot_key = 'it')),
         a.id, s.asset_tag, s.asset_name, s.serial_number,
         a.assigned_date, a.assigned_condition, s.status,
         a.return_date is not null, a.return_date,
         t.assigned_by_name, t.assigned_at
    from hr.clearance_asset_tasks t
    join hr.clearance_cases c   on c.id = t.case_id
    join it.asset_assignments a on a.id = t.asset_assignment_id
    join it.assets s            on s.id = a.asset_id
   where t.assignee_person_id = public.current_person_id()
   order by c.last_working_date, c.case_number, s.asset_tag
   limit 500;
$$;

-- =====================================================================
-- 3. REPLACED: return an asset - the IT signer, or the person this asset was handed to
-- =====================================================================
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
  if not (hr.is_clearance_signer(p_case_id, 'it')
          or exists (select 1 from hr.clearance_asset_tasks t
                      where t.case_id = p_case_id and t.asset_assignment_id = p_assignment_id
                        and t.assignee_person_id = v_me)) then
    raise exception 'Only the IT signer for this case, or the person this asset was given to, can return it.'
      using errcode = '42501';
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
  if not found or v_a.person_id is distinct from v_case.person_id or v_a.return_date is not null then
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
-- 4. Grants
-- =====================================================================
revoke all on function hr.assign_clearance_asset(uuid, uuid, uuid)              from public, anon;
revoke all on function hr.my_clearance_asset_tasks()                            from public, anon;
revoke all on function hr.clearance_return_asset(uuid, uuid, text, text, text)  from public, anon;

grant execute on function hr.assign_clearance_asset(uuid, uuid, uuid)           to authenticated, service_role;
grant execute on function hr.my_clearance_asset_tasks()                         to authenticated, service_role;
grant execute on function hr.clearance_return_asset(uuid, uuid, text, text, text) to authenticated, service_role;

commit;

-- CHECKS (run after applying):
--   a) the trigger exists (1 row):
--        select tgname from pg_trigger where tgname = 'trg_clearance_notify_on_case_change';
--   b) after forwarding a case, the queued notifications:
--        select n.created_at, p.full_name, n.title, n.email_status, n.email_error
--          from it.notifications n left join public.persons p on p.id = n.recipient_person_id
--         where n.event like 'clearance_%' order by n.created_at desc limit 20;
