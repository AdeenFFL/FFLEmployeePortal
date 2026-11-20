-- Replicated from supabase/it-migrations/talha/talha_hr_0011_clearance_line_assignments.sql
-- (applied live 2026-11-20, by Talha). Depends on 0080-0089 (this batch) and it.notify
-- (migration 0029: in-app + email queue).
--
-- The IT Team Lead can hand out IT clearance lines to IT staff ("My clearance tasks"); the
-- assignee is notified and may answer only their own lines. hr.set_clearance_response is
-- replaced (same arguments) so an assignee may answer their own line.

begin;

-- =====================================================================
-- 1. Who was given which line
-- =====================================================================
create table hr.clearance_line_assignments (
  case_id              uuid not null references hr.clearance_cases (id) on delete cascade,
  line_id              uuid not null references hr.clearance_lines (id),
  assignee_person_id   uuid not null references public.persons (id) on delete cascade,
  -- copies, so the lead's page needs no access to persons
  assignee_name        text not null,
  assigned_by          uuid references public.persons (id) on delete set null,
  assigned_by_name     text,
  assigned_at          timestamptz not null default now(),
  primary key (case_id, line_id)
);

create index idx_clearance_line_assignments_assignee
  on hr.clearance_line_assignments (assignee_person_id);

grant select on hr.clearance_line_assignments to authenticated;
grant select, insert, update, delete on hr.clearance_line_assignments to service_role;
revoke insert, update, delete on hr.clearance_line_assignments from authenticated;

alter table hr.clearance_line_assignments enable row level security;

-- Whoever can read the case (signers, HRBP, read_all) sees its assignments; an assignee sees
-- their own.
create policy "line assignments readable with the case or by the assignee"
  on hr.clearance_line_assignments for select to authenticated
  using (
    assignee_person_id = public.current_person_id()
    or exists (select 1 from hr.clearance_cases c where c.id = clearance_line_assignments.case_id)
  );

-- =====================================================================
-- 2. IT staff: who can be given a line
-- =====================================================================
create or replace function hr.clearance_is_it_staff(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.persons p
      join public.user_roles ur       on ur.person_id = p.id
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions perm    on perm.id = rp.permission_id
     where p.id = p_person_id
       and p.person_type = 'employee'
       and p.status = 'Active'
       and perm.key = 'it.tickets.update'
  );
$$;

create or replace function hr.clearance_search_it_staff(p_query text, p_limit integer default 20)
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
     where hr.clearance_is_it_staff(p.id)
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- =====================================================================
-- 3. Assign / reassign / unassign one line (the signer of that part only)
-- =====================================================================
create or replace function hr.assign_clearance_line(
  p_case_id    uuid,
  p_line_id    uuid,
  p_person_id  uuid      -- null = take the line back
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
  v_line      record;
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

  select l.slot_key, l.description, l.is_active, l.auto_from_form into v_line
    from hr.clearance_lines l where l.id = p_line_id;
  if not found or not v_line.is_active then
    raise exception 'Line not found.';
  end if;
  -- ASSIGNABLE SLOTS
  if v_line.slot_key not in ('it') then
    raise exception 'Lines of this part cannot be assigned.';
  end if;
  if v_line.auto_from_form is not null then
    raise exception 'This line fills in by itself and cannot be assigned.';
  end if;
  if not hr.is_clearance_signer(p_case_id, v_line.slot_key) then
    raise exception 'Only the signer of this part can assign its lines.' using errcode = '42501';
  end if;
  if exists (select 1 from hr.clearance_signoffs s
              where s.case_id = p_case_id and s.slot_key = v_line.slot_key) then
    raise exception 'This part has already been signed and is locked.';
  end if;
  if exists (select 1 from hr.clearance_skips k
              where k.case_id = p_case_id and k.slot_key = v_line.slot_key) then
    raise exception 'This part was skipped for this request.';
  end if;

  select a.assignee_person_id into v_previous
    from hr.clearance_line_assignments a
   where a.case_id = p_case_id and a.line_id = p_line_id;

  if p_person_id is null then
    delete from hr.clearance_line_assignments
     where case_id = p_case_id and line_id = p_line_id;
    return;
  end if;

  if p_person_id = v_case.person_id then
    raise exception 'The leaving employee cannot clear their own lines.';
  end if;
  if not hr.clearance_is_it_staff(p_person_id) then
    raise exception 'Choose an active IT staff member.';
  end if;

  select p.full_name into v_name from public.persons p where p.id = p_person_id;
  select p.full_name into v_me_name from public.persons p where p.id = v_me;

  insert into hr.clearance_line_assignments
    (case_id, line_id, assignee_person_id, assignee_name, assigned_by, assigned_by_name, assigned_at)
  values (p_case_id, p_line_id, p_person_id, v_name, v_me, v_me_name, now())
  on conflict (case_id, line_id) do update
     set assignee_person_id = excluded.assignee_person_id,
         assignee_name      = excluded.assignee_name,
         assigned_by        = excluded.assigned_by,
         assigned_by_name   = excluded.assigned_by_name,
         assigned_at        = excluded.assigned_at;

  -- In-app notification + queued email (it.notify skips the actor, so assigning yourself sends
  -- nothing). Only when the line goes to someone new.
  if v_previous is distinct from p_person_id then
    perform it.notify(
      p_person_id,
      'clearance_task_assigned',
      format('Clearance task: %s', v_line.description),
      format('%s · %s · last working date %s · assigned by %s',
             v_case.case_number, v_case.employee_name,
             to_char(v_case.last_working_date, 'DD Mon YYYY'), coalesce(v_me_name, '—')),
      '/hr/clearance/tasks'
    );
  end if;
end;
$$;

-- =====================================================================
-- 4. What an assignee sees: only their own lines (no other case data)
-- =====================================================================
create or replace function hr.my_clearance_tasks()
returns table (
  case_id             uuid,
  case_number         text,
  employee_name       text,
  employee_code       text,
  designation         text,
  last_working_date   date,
  case_status         text,
  part_locked         boolean,
  line_id             uuid,
  line_description    text,
  sort_order          integer,
  outcome             text,
  remarks             text,
  responded_at        timestamptz,
  answered_by_me      boolean,
  assigned_by_name    text,
  assigned_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.case_number, c.employee_name, c.employee_code, c.designation,
         c.last_working_date, c.status,
         (exists (select 1 from hr.clearance_signoffs s
                   where s.case_id = c.id and s.slot_key = l.slot_key)
          or exists (select 1 from hr.clearance_skips k
                      where k.case_id = c.id and k.slot_key = l.slot_key)),
         l.id, l.description, l.sort_order,
         r.outcome, r.remarks, r.responded_at,
         coalesce(r.responded_by = a.assignee_person_id, false),
         a.assigned_by_name, a.assigned_at
    from hr.clearance_line_assignments a
    join hr.clearance_cases c on c.id = a.case_id
    join hr.clearance_lines l on l.id = a.line_id
    left join hr.clearance_responses r on r.case_id = a.case_id and r.line_id = a.line_id
   where a.assignee_person_id = public.current_person_id()
   order by c.last_working_date, c.case_number, l.sort_order
   limit 500;
$$;

-- =====================================================================
-- 5. REPLACED: answer a line - the signer of the part, or the person the line is assigned to
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

  if not (hr.is_clearance_signer(p_case_id, v_line.slot_key)
          or exists (select 1 from hr.clearance_line_assignments a
                      where a.case_id = p_case_id and a.line_id = p_line_id
                        and a.assignee_person_id = v_me)) then
    raise exception 'You are not a signer for this part of the form, and this line is not assigned to you.'
      using errcode = '42501';
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
-- 6. Grants
-- =====================================================================
revoke all on function hr.clearance_is_it_staff(uuid)                  from public, anon, authenticated;
revoke all on function hr.clearance_search_it_staff(text, integer)     from public, anon;
revoke all on function hr.assign_clearance_line(uuid, uuid, uuid)      from public, anon;
revoke all on function hr.my_clearance_tasks()                         from public, anon;
revoke all on function hr.set_clearance_response(uuid, uuid, text, text) from public, anon;

grant execute on function hr.clearance_is_it_staff(uuid)               to service_role;
grant execute on function hr.clearance_search_it_staff(text, integer)  to authenticated, service_role;
grant execute on function hr.assign_clearance_line(uuid, uuid, uuid)   to authenticated, service_role;
grant execute on function hr.my_clearance_tasks()                      to authenticated, service_role;
grant execute on function hr.set_clearance_response(uuid, uuid, text, text) to authenticated, service_role;

commit;

-- CHECKS (run after applying):
--   a) IT staff the lead can choose from (should list the IT team):
--        select p.full_name from public.persons p where hr.clearance_is_it_staff(p.id) order by 1;
--   b) the new functions exist (should return 4 rows):
--        select proname from pg_proc
--         where proname in ('clearance_search_it_staff', 'assign_clearance_line',
--                           'my_clearance_tasks', 'clearance_is_it_staff');
