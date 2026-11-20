-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding redesign - HR clearance system (company form HR/002, 4 forms)
-- Depends on:  schema hr (exists), public.persons (id, full_name, employee_code, designation,
--              department_id, site_id, company_id, date_of_joining, personal_email, phone,
--              address, status), public.org_units, public.companies,
--              public.has_permission(), public.current_person_id(), public.set_updated_at().
--              The permission rows (hr.clearance.*) and role grants come in a SEPARATE file;
--              until then nobody can use the functions or the settings tables (safe default).
-- Applied to live DB: YES (2026-11-12, by Talha)
--
-- HOW THE PROCESS MAPS TO THESE TABLES
--   * An employee submits from their profile       -> submit_clearance_self()   status Submitted
--   * HRBP forwards it (or raises it for someone)  -> forward_clearance_case() / raise_clearance_for()
--                                                     status In Clearance
--   * Each signer answers THEIR lines and signs    -> set_clearance_response() / sign_clearance()
--   * HR (page one) signs LAST                     -> status Completed, then the 4 forms are printed
--   * WHO signs is DATA in hr.clearance_signers (per site, or per department), not code,
--     so Accounts / Department Head / DM Store etc. can be set without a new migration.
--
-- ASSUMPTIONS (confirm, all changeable as data or in one line):
--   * Slots and who signs them: HR (page one), Department Head (page one, per DEPARTMENT),
--     Deputy Manager Admin, Deputy Manager Store, Deputy Manager Finance (Accounts form),
--     IT Team Lead (all per SITE). The people are set per site by HR (hr.clearance_signers).
--   * Form lines are copied from the paper form HR/002; HR can edit them later.
--   * Answers are stored as Yes / No / N/A. The screens show the form's own words
--     (Collected / Not collected / N/A, Cleared / Not cleared / N/A, Yes / No / N/A).
--   * Signers sign in any order; HR (page one) can only sign after everyone else.
--   * One open request per employee at a time.
--
-- Safe to undo (new objects only):
--   drop function hr.cancel_clearance_case(uuid, text);
--   drop function hr.sign_clearance(uuid, text, text);
--   drop function hr.set_clearance_response(uuid, uuid, text, text);
--   drop function hr.forward_clearance_case(uuid);
--   drop function hr.raise_clearance_for(uuid, date);
--   drop function hr.submit_clearance_self(date);
--   drop function hr.create_clearance_case_internal(uuid, date, uuid, text);
--   drop function hr.clearance_check_ready(uuid, uuid);
--   drop function hr.clearance_missing_slots(uuid, uuid);
--   drop function hr.is_any_clearance_signer(uuid);
--   drop function hr.is_clearance_signer(uuid, text);
--   drop function hr.clearance_signer_scope_check();
--   drop table hr.clearance_signoffs, hr.clearance_responses, hr.clearance_cases,
--              hr.clearance_signers, hr.clearance_lines, hr.clearance_slots;
--   drop sequence hr.clearance_case_seq;

begin;

-- =====================================================================
-- 1. Signature slots (who signs what). Small, fixed list; HR sets the people.
-- =====================================================================
create table hr.clearance_slots (
  slot_key    text primary key,
  form_key    text not null check (form_key in ('page_one', 'admin', 'accounts', 'it')),
  label       text not null,
  scope       text not null check (scope in ('site', 'department')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

insert into hr.clearance_slots (slot_key, form_key, label, scope, sort_order) values
  ('hr',        'page_one', 'HR (page one)',                                   'site',       10),
  ('dept_head', 'page_one', 'Department Head (page one)',                      'department', 20),
  ('admin',     'admin',    'Deputy Manager Admin',                            'site',       30),
  ('store',     'admin',    'Deputy Manager Store',                            'site',       40),
  ('accounts',  'accounts', 'Deputy Manager Finance (Accounts)',               'site',       50),
  ('it',        'it',       'IT Team Lead',                                    'site',       60)
on conflict (slot_key) do nothing;

-- =====================================================================
-- 2. The lines of the forms (copied from HR/002). HR can edit these.
-- =====================================================================
create table hr.clearance_lines (
  id             uuid primary key default gen_random_uuid(),
  line_key       text not null unique,
  form_key       text not null check (form_key in ('page_one', 'admin', 'accounts', 'it')),
  slot_key       text not null references hr.clearance_slots (slot_key),
  description    text not null,
  -- page-one ticks that fill themselves once that whole form is signed
  auto_from_form text check (auto_from_form in ('admin', 'accounts', 'it')),
  sort_order     integer not null default 0,
  is_active      boolean not null default true
);

insert into hr.clearance_lines (line_key, form_key, slot_key, description, auto_from_form, sort_order) values
  -- page one: checklist signed by HR
  ('p1.admin',        'page_one', 'hr', 'Administration / Sales Operation / Area Office', 'admin',    10),
  ('p1.accounts',     'page_one', 'hr', 'Accounts',                                        'accounts', 20),
  ('p1.it',           'page_one', 'hr', 'Information Technology',                          'it',       30),
  ('p1.recommended',  'page_one', 'hr', 'Resignation - Duly recommended',                  null,       40),
  ('p1.exit_interview','page_one','hr', 'Exit interview',                                  null,       50),
  ('p1.expense',      'page_one', 'hr', 'Approved Expense Reimbursement Form (if any)',    null,       60),
  ('p1.company_card', 'page_one', 'hr', 'Company card',                                    null,       70),
  ('p1.medical_card', 'page_one', 'hr', 'Medical Card',                                    null,       80),
  ('p1.handing_over', 'page_one', 'hr', 'Handing over done to (write the name in remarks)', null,     90),
  ('p1.data_received','page_one', 'hr', 'Complete Data received by Line Manager',          null,      100),
  ('p1.email_forward','page_one', 'hr', 'Email forwarding to (write the address in remarks)', null,  110),
  -- form 1: administration / sales operation / area office
  ('adm.car',         'admin', 'admin', 'Company assigned car along with Delivery letter, Tool Kit of Car / Spare Wheels', null, 10),
  ('adm.fuel',        'admin', 'admin', 'Fuel Card',                                        null, 20),
  ('adm.meal',        'admin', 'admin', 'Meal charges',                                     null, 30),
  ('adm.mobile',      'admin', 'admin', 'Mobile phone / Sim with accessories',              null, 40),
  ('adm.stores',      'admin', 'store', 'Company stocks, materials, stores, spares and/or other assets properly handed over', null, 50),
  ('adm.other',       'admin', 'admin', 'Any other outstanding company Property / Assets (Policy Manual, Camera / Internet Device / External Hard Drive etc.)', null, 60),
  -- form 2: accounts
  ('acc.travel',      'accounts', 'accounts', 'Travel Advances',                            null, 10),
  ('acc.cash',        'accounts', 'accounts', 'Cash advances',                              null, 20),
  ('acc.temp',        'accounts', 'accounts', 'Temporary / Permanent advances',             null, 30),
  ('acc.loans',       'accounts', 'accounts', 'Loans',                                      null, 40),
  ('acc.other',       'accounts', 'accounts', 'Any other outstanding amount',               null, 50),
  -- form 3: information technology
  ('it.computer',     'it', 'it', 'Computer access removed',                                null, 10),
  ('it.laptop',       'it', 'it', 'Laptop handed over / Laptop accessories',                null, 20),
  ('it.email',        'it', 'it', 'Email ID removed',                                       null, 30),
  ('it.forwarding',   'it', 'it', 'Email forwarding to (in case required)',                 null, 40),
  ('it.data',         'it', 'it', 'Data deleted / transferred',                             null, 50),
  ('it.login',        'it', 'it', 'User Login access removed (if applicable)',              null, 60),
  ('it.internet',     'it', 'it', 'Internet Device',                                        null, 70),
  ('it.other',        'it', 'it', 'Any other system access / information',                  null, 80)
on conflict (line_key) do nothing;

-- =====================================================================
-- 3. Who signs, per site (or per department for the Department Head).
-- =====================================================================
create table hr.clearance_signers (
  id             uuid primary key default gen_random_uuid(),
  slot_key       text not null references hr.clearance_slots (slot_key),
  site_id        uuid references public.org_units (id),
  department_id  uuid references public.org_units (id),
  person_id      uuid not null references public.persons (id) on delete cascade,
  is_primary     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.persons (id) on delete set null,  -- filled by the trigger below
  check ((site_id is not null) <> (department_id is not null))
);

create unique index uq_clearance_signer_site
  on hr.clearance_signers (slot_key, site_id, person_id) where site_id is not null;
create unique index uq_clearance_signer_dept
  on hr.clearance_signers (slot_key, department_id, person_id) where department_id is not null;
create unique index uq_clearance_primary_site
  on hr.clearance_signers (slot_key, site_id) where is_primary and site_id is not null;
create unique index uq_clearance_primary_dept
  on hr.clearance_signers (slot_key, department_id) where is_primary and department_id is not null;
create index idx_clearance_signers_person on hr.clearance_signers (person_id);

-- A site slot needs a site, a department slot needs a department.
create or replace function hr.clearance_signer_scope_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  select s.scope into v_scope from hr.clearance_slots s where s.slot_key = new.slot_key;
  if v_scope = 'site' and new.site_id is null then
    raise exception 'This signature slot is set per SITE: choose a site.';
  end if;
  if v_scope = 'department' and new.department_id is null then
    raise exception 'This signature slot is set per DEPARTMENT: choose a department.';
  end if;
  -- the server decides who created the row, never the client
  if tg_op = 'INSERT' then
    new.created_by := public.current_person_id();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger trg_clearance_signer_scope
  before insert or update on hr.clearance_signers
  for each row execute function hr.clearance_signer_scope_check();

create trigger trg_clearance_signers_updated_at
  before update on hr.clearance_signers
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 4. The clearance case (one per offboarding request)
-- =====================================================================
create sequence hr.clearance_case_seq;

create table hr.clearance_cases (
  id                    uuid primary key default gen_random_uuid(),
  case_number           text not null unique
                        default ('CLR-' || lpad(nextval('hr.clearance_case_seq')::text, 6, '0')),
  person_id             uuid not null references public.persons (id) on delete cascade,  -- the leaving employee
  -- snapshot of the employee at submission (persons is not readable by other users)
  employee_name         text not null,
  employee_code         text,
  designation           text,
  department_id         uuid references public.org_units (id),
  site_id               uuid references public.org_units (id),
  company_id            uuid references public.companies (id),
  date_of_joining       date,
  contact_phone         text,
  contact_email         text,
  postal_address        text,
  reporting_manager_name text,   -- typed by HR (no manager data exists)
  last_working_date     date not null,
  raised_by_person_id   uuid references public.persons (id) on delete set null,
  raised_via            text not null check (raised_via in ('self', 'hrbp')),
  status                text not null default 'Submitted'
                        check (status in ('Submitted', 'In Clearance', 'Completed', 'Cancelled')),
  hrbp_person_id        uuid references public.persons (id) on delete set null,
  forwarded_at          timestamptz,
  employee_signed_at    timestamptz,   -- automatic e-sign when the employee submits
  completed_at          timestamptz,
  cancelled_reason      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Only one open request per employee.
create unique index uq_clearance_one_open_per_person
  on hr.clearance_cases (person_id) where status in ('Submitted', 'In Clearance');
create index idx_clearance_cases_status on hr.clearance_cases (status);
create index idx_clearance_cases_site   on hr.clearance_cases (site_id);

create trigger trg_clearance_cases_updated_at
  before update on hr.clearance_cases
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 5. Answers per line, and the signatures
-- =====================================================================
create table hr.clearance_responses (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references hr.clearance_cases (id) on delete cascade,
  line_id       uuid not null references hr.clearance_lines (id),
  outcome       text check (outcome in ('Yes', 'No', 'N/A')),
  remarks       text,
  responded_by  uuid references public.persons (id) on delete set null,
  responded_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (case_id, line_id)
);

create trigger trg_clearance_responses_updated_at
  before update on hr.clearance_responses
  for each row execute function public.set_updated_at();

create table hr.clearance_signoffs (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references hr.clearance_cases (id) on delete cascade,
  slot_key              text not null references hr.clearance_slots (slot_key),
  signed_by_person_id   uuid references public.persons (id) on delete set null,
  signer_name           text not null,      -- frozen at signing time: this IS the e-signature
  signer_designation    text,
  signed_at             timestamptz not null default now(),
  remarks               text,
  unique (case_id, slot_key)
);

create index idx_clearance_responses_case on hr.clearance_responses (case_id);
create index idx_clearance_signoffs_case  on hr.clearance_signoffs (case_id);

-- =====================================================================
-- 6. Helper functions (used by the security rules and by the functions below)
-- =====================================================================
create or replace function hr.is_clearance_signer(p_case_id uuid, p_slot_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from hr.clearance_cases c
      join hr.clearance_slots s   on s.slot_key = p_slot_key
      join hr.clearance_signers g on g.slot_key = s.slot_key
     where c.id = p_case_id
       and s.is_active
       and g.person_id = public.current_person_id()
       and ((s.scope = 'site'       and g.site_id       = c.site_id)
         or (s.scope = 'department' and g.department_id = c.department_id))
  );
$$;

create or replace function hr.is_any_clearance_signer(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from hr.clearance_cases c
      join hr.clearance_signers g on g.person_id = public.current_person_id()
      join hr.clearance_slots s   on s.slot_key = g.slot_key
     where c.id = p_case_id
       and s.is_active
       and ((s.scope = 'site'       and g.site_id       = c.site_id)
         or (s.scope = 'department' and g.department_id = c.department_id))
  );
$$;

-- Labels of the slots that have NO signer set for this site / department.
create or replace function hr.clearance_missing_slots(p_site_id uuid, p_department_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.label order by s.sort_order), '{}'::text[])
    from hr.clearance_slots s
   where s.is_active
     and not exists (
       select 1 from hr.clearance_signers g
        where g.slot_key = s.slot_key
          and ((s.scope = 'site'       and g.site_id       = p_site_id)
            or (s.scope = 'department' and g.department_id = p_department_id))
     );
$$;

-- Stops with a clear message when the employee has no site / department, or a signer is missing.
create or replace function hr.clearance_check_ready(p_site_id uuid, p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  if p_site_id is null then
    raise exception 'This employee has no site set on their profile. Ask HR or Admin to set it first.';
  end if;
  if p_department_id is null and exists (
       select 1 from hr.clearance_slots s where s.is_active and s.scope = 'department') then
    raise exception 'This employee has no department set on their profile. Ask HR or Admin to set it first.';
  end if;
  v_missing := hr.clearance_missing_slots(p_site_id, p_department_id);
  if array_length(v_missing, 1) is not null then
    raise exception 'No signer is set for: %. Ask HR to set the signers for this site first.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- =====================================================================
-- 7. Security (Row Level Security): people READ here; all changes to cases,
--    answers and signatures go through the functions in section 8.
-- =====================================================================
-- service_role needs schema usage (no earlier migration gave it for hr)
grant usage on schema hr to service_role;
grant usage, select on sequence hr.clearance_case_seq to service_role;

grant select on hr.clearance_slots, hr.clearance_cases,
                hr.clearance_responses, hr.clearance_signoffs to authenticated;
grant select, insert, update on hr.clearance_lines to authenticated;
grant select, insert, update, delete on hr.clearance_signers to authenticated;
grant select, insert, update, delete on
  hr.clearance_slots, hr.clearance_lines, hr.clearance_signers, hr.clearance_cases,
  hr.clearance_responses, hr.clearance_signoffs to service_role;

-- hr has default privileges that hand out insert/update/delete on every new table,
-- so take them away from the tables that must stay read-only (the functions write them).
revoke insert, update, delete on hr.clearance_slots, hr.clearance_cases,
                                 hr.clearance_responses, hr.clearance_signoffs from authenticated;
revoke delete on hr.clearance_lines from authenticated;

alter table hr.clearance_slots     enable row level security;
alter table hr.clearance_lines     enable row level security;
alter table hr.clearance_signers   enable row level security;
alter table hr.clearance_cases     enable row level security;
alter table hr.clearance_responses enable row level security;
alter table hr.clearance_signoffs  enable row level security;

create policy "slots readable by authenticated"
  on hr.clearance_slots for select to authenticated using (true);

create policy "lines readable by authenticated"
  on hr.clearance_lines for select to authenticated using (true);
create policy "lines insert by form managers"
  on hr.clearance_lines for insert to authenticated
  with check (public.has_permission('hr.clearance.manage_forms'));
create policy "lines update by form managers"
  on hr.clearance_lines for update to authenticated
  using (public.has_permission('hr.clearance.manage_forms'))
  with check (public.has_permission('hr.clearance.manage_forms'));

create policy "signers readable by managers, HRBP or the signer"
  on hr.clearance_signers for select to authenticated
  using (public.has_permission('hr.clearance.manage_signers')
         or public.has_permission('hr.clearance.read_all')
         or person_id = public.current_person_id());
create policy "signers insert by signer managers"
  on hr.clearance_signers for insert to authenticated
  with check (public.has_permission('hr.clearance.manage_signers'));
create policy "signers update by signer managers"
  on hr.clearance_signers for update to authenticated
  using (public.has_permission('hr.clearance.manage_signers'))
  with check (public.has_permission('hr.clearance.manage_signers'));
create policy "signers delete by signer managers"
  on hr.clearance_signers for delete to authenticated
  using (public.has_permission('hr.clearance.manage_signers'));

create policy "cases readable by owner, HRBP or a signer of the case"
  on hr.clearance_cases for select to authenticated
  using (person_id = public.current_person_id()
         or public.has_permission('hr.clearance.read_all')
         or hr.is_any_clearance_signer(id));

-- Answers and remarks are private to HR/HRBP (read_all) and to the signer of THAT part.
-- (The employee and other signers see the signatures, not the answers.)
create policy "responses readable by HR or the signer of that part"
  on hr.clearance_responses for select to authenticated
  using (public.has_permission('hr.clearance.read_all')
         or exists (select 1 from hr.clearance_lines l
                     where l.id = clearance_responses.line_id
                       and hr.is_clearance_signer(clearance_responses.case_id, l.slot_key)));

create policy "signoffs readable with the case"
  on hr.clearance_signoffs for select to authenticated
  using (exists (select 1 from hr.clearance_cases c where c.id = clearance_signoffs.case_id));

-- =====================================================================
-- 8. The functions that do the writing
-- =====================================================================

-- Internal: builds the case, the employee snapshot and the empty answer rows.
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
  if v_p.status is distinct from 'Active' then
    raise exception 'Only an active employee can start a clearance.';
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

-- The employee submits their own request (profile page).
create or replace function hr.submit_clearance_self(p_last_working_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if v_me is null or not public.has_permission('hr.clearance.request_self') then
    raise exception 'You are not allowed to submit an offboarding request.' using errcode = '42501';
  end if;
  return hr.create_clearance_case_internal(v_me, p_last_working_date, v_me, 'self');
end;
$$;

-- HRBP starts a clearance for an employee (HR management); goes straight to clearance.
create or replace function hr.raise_clearance_for(p_person_id uuid, p_last_working_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_person_id();
begin
  if v_me is null or not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to start a clearance for an employee.' using errcode = '42501';
  end if;
  return hr.create_clearance_case_internal(p_person_id, p_last_working_date, v_me, 'hrbp');
end;
$$;

-- HRBP forwards a submitted request for clearance.
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

  perform hr.clearance_check_ready(v_case.site_id, v_case.department_id);

  update hr.clearance_cases
     set status = 'In Clearance', hrbp_person_id = v_me, forwarded_at = now()
   where id = p_case_id;
end;
$$;

-- A signer answers ONE line of their own form.
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

  select c.id, c.status into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
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

-- A signer signs their part (the e-signature is their name and the time).
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

  select c.id, c.status into v_case
    from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
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
    insert into hr.clearance_responses (case_id, line_id, outcome, responded_at)
    select p_case_id, l.id, 'Yes', now()
      from hr.clearance_lines l
     where l.is_active and l.auto_from_form = v_form
    on conflict (case_id, line_id) do update set outcome = 'Yes', responded_at = now();
  end if;

  if p_slot_key = 'hr' then
    update hr.clearance_cases
       set status = 'Completed', completed_at = now()
     where id = p_case_id;
  end if;
end;
$$;

-- HRBP cancels a request that is not finished.
create or replace function hr.cancel_clearance_case(p_case_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_person_id();
  v_status text;
begin
  if v_me is null or not public.has_permission('hr.clearance.forward') then
    raise exception 'You are not allowed to cancel requests.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Please give a reason.';
  end if;

  select c.status into v_status from hr.clearance_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_status not in ('Submitted', 'In Clearance') then
    raise exception 'A % request cannot be cancelled.', v_status;
  end if;

  update hr.clearance_cases
     set status = 'Cancelled', cancelled_reason = p_reason
   where id = p_case_id;
end;
$$;

-- =====================================================================
-- 9. Who may call what: logged-in users only (each function also checks)
-- =====================================================================
revoke all on function hr.create_clearance_case_internal(uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function hr.create_clearance_case_internal(uuid, date, uuid, text) to service_role;

revoke all on function hr.is_clearance_signer(uuid, text)                    from public, anon;
revoke all on function hr.is_any_clearance_signer(uuid)                      from public, anon;
revoke all on function hr.clearance_missing_slots(uuid, uuid)                from public, anon;
revoke all on function hr.clearance_check_ready(uuid, uuid)                  from public, anon;
revoke all on function hr.submit_clearance_self(date)                        from public, anon;
revoke all on function hr.raise_clearance_for(uuid, date)                    from public, anon;
revoke all on function hr.forward_clearance_case(uuid)                       from public, anon;
revoke all on function hr.set_clearance_response(uuid, uuid, text, text)     from public, anon;
revoke all on function hr.sign_clearance(uuid, text, text)                   from public, anon;
revoke all on function hr.cancel_clearance_case(uuid, text)                  from public, anon;

grant execute on function hr.is_clearance_signer(uuid, text)                 to authenticated, service_role;
grant execute on function hr.is_any_clearance_signer(uuid)                   to authenticated, service_role;
grant execute on function hr.clearance_missing_slots(uuid, uuid)             to authenticated, service_role;
grant execute on function hr.clearance_check_ready(uuid, uuid)               to authenticated, service_role;
grant execute on function hr.submit_clearance_self(date)                     to authenticated, service_role;
grant execute on function hr.raise_clearance_for(uuid, date)                 to authenticated, service_role;
grant execute on function hr.forward_clearance_case(uuid)                    to authenticated, service_role;
grant execute on function hr.set_clearance_response(uuid, uuid, text, text)  to authenticated, service_role;
grant execute on function hr.sign_clearance(uuid, text, text)                to authenticated, service_role;
grant execute on function hr.cancel_clearance_case(uuid, text)               to authenticated, service_role;

commit;
