-- Employee Portal — Combined migration: (A) fixes org_units <-> companies to be many-to-many,
-- (B) splits profiles -> persons + user_accounts + user_roles.
--
-- Written against the actual current state of the live database (confirmed via schema dump):
--   companies, org_units.company_id, org_units.site_type  -> already exist (from 0007)
--   org_unit_companies                                    -> does NOT exist yet
--   persons, user_accounts, user_roles                    -> do NOT exist yet
--   profiles (and everything FK'd to it)                  -> still the original shape
-- This migration is NOT idempotent / not safe to run twice, and assumes exactly that starting
-- state — don't run it against an environment that already has persons/user_accounts/user_roles.

-- ===========================================================================
-- PART A — org_units <-> companies many-to-many (supersedes org_units.company_id)
-- ===========================================================================
--
-- Rationale: a physical site (a shared plant, warehouse, or head-office building) can serve
-- more than one sub-company at once, and a department can be company-specific or fully shared
-- (e.g. central HR at Head Office) — a single company_id column can't express that. Nothing
-- elsewhere in the schema derives a person's or transaction's company from their site — persons
-- and user_roles (created in Part B below) carry company_id and site_id as independent
-- columns — so this table has no downstream consumers to keep in sync; it's a pure lookup.

create table org_unit_companies (
  org_unit_id uuid not null references org_units(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  primary key (org_unit_id, company_id)
);

alter table org_unit_companies enable row level security;

create policy "org_unit_companies readable by authenticated" on org_unit_companies
  for select to authenticated using (true);

create policy "org_unit_companies admin write" on org_unit_companies
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Carry forward any company_id already set on org_units before dropping the column.
insert into org_unit_companies (org_unit_id, company_id)
select id, company_id from org_units where company_id is not null
on conflict do nothing;

alter table org_units drop column company_id;

-- ===========================================================================
-- PART B — Identity split: profiles -> persons + user_accounts + user_roles.
-- ===========================================================================
-- Rationale: profiles forced every person to have an auth.users row, which cannot represent
-- 3rd-party/vendor staff who get no login, had no employment_type, and allowed only one role
-- per person with no company/site scoping. See project docs (context.md, 01-platform-design-
-- and-sop.md Section 4) for full rationale.
--
-- Cutover approach: this app has no production users yet, so this migration backfills any
-- existing profiles rows. The final `drop table profiles;` is commented out below as a safety
-- margin — apply this migration, deploy the app-code changes that stop reading `profiles`
-- (already done alongside this migration), verify in staging, then uncomment the drop and run
-- it as its own follow-up migration.

-- ---------------------------------------------------------------------------
-- B.1. persons — universal identity, decoupled from auth.users
-- ---------------------------------------------------------------------------

create table persons (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  personal_email text,
  phone text,
  cnic text,
  date_of_birth date,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,

  person_type text not null default 'employee'
    check (person_type in ('employee', 'third_party', 'other')),

  employee_code text unique,
  designation text,
  company_id uuid references companies(id),
  site_id uuid references org_units(id),

  employment_type text
    check (employment_type in ('permanent', 'contractual_with_email', 'contractual_no_email', 'third_party_vendor')),
  contract_start_date date,
  contract_end_date date,
  date_of_joining date,

  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger persons_set_updated_at
  before update on persons
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- B.2. user_accounts — login layer, optional, links to auth.users
-- ---------------------------------------------------------------------------

create table user_accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references persons(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,

  auth_method text not null default 'microsoft'
    check (auth_method in ('microsoft', 'password', 'phone_otp')),

  is_external boolean not null default false,
  sponsoring_company_id uuid references companies(id),
  access_expires_at timestamptz,

  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  last_login_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_accounts_set_updated_at
  before update on user_accounts
  for each row execute function set_updated_at();

create function enforce_external_account_rules()
returns trigger as $$
begin
  if new.is_external and (new.access_expires_at is null or new.sponsoring_company_id is null) then
    raise exception 'External accounts require access_expires_at and sponsoring_company_id';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_external_account_rules
  before insert or update on user_accounts
  for each row execute function enforce_external_account_rules();

-- ---------------------------------------------------------------------------
-- B.3. user_roles — replaces profiles.role_id (single, unscoped) with multi-role,
--      optionally company/site-scoped assignment.
-- ---------------------------------------------------------------------------

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  company_id uuid references companies(id),
  site_id uuid references org_units(id),
  granted_by uuid references persons(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);

create index user_roles_person_id_idx on user_roles (person_id);

-- ---------------------------------------------------------------------------
-- B.4. Backfill from profiles (reuses profiles.id as persons.id so every existing
--      FK — role_permissions.granted_by, invited_users.invited_by, educational_documents,
--      dependents, insurance_policies, audit_log, announcements, polls, poll_votes —
--      can be repointed with zero value remapping in step B.8).
--
--      Note: profiles.department/site (free text) have no destination column on persons —
--      persons.company_id/site_id are proper FKs, not populated automatically since the free
--      text can't be reliably resolved to org_units/companies rows. This is an accepted,
--      flagged gap: re-assign company/site per person via the admin UI after this migration
--      runs (see 04-claude-code-refactor-instructions.md Section 4 Phase E).
-- ---------------------------------------------------------------------------

insert into persons (
  id, full_name, personal_email, cnic, date_of_birth, address,
  emergency_contact_name, emergency_contact_phone, employee_code,
  designation, date_of_joining, status, notes, created_at, updated_at
)
select
  id, coalesce(display_name, email), email, cnic, date_of_birth, address,
  emergency_contact_name, emergency_contact_phone, employee_code,
  designation, date_of_joining, status, notes, created_at, updated_at
from profiles;

insert into user_accounts (
  person_id, auth_user_id, email, auth_method, status, last_login_at, created_at, updated_at
)
select
  id, id, email, auth_method, status, last_login_at, created_at, updated_at
from profiles;

insert into user_roles (person_id, role_id, granted_at)
select id, role_id, created_at from profiles where role_id is not null;

-- Verify before proceeding (run manually, compare the three counts):
--   select count(*) from profiles;
--   select count(*) from persons;
--   select count(*) from user_accounts;

-- ---------------------------------------------------------------------------
-- B.5. current_person_id() — the one helper every RLS policy and RPC below uses
--      to go from auth.uid() -> persons.id. Mirrors is_admin()'s security-definer
--      shape to avoid RLS self-recursion on persons/user_accounts.
-- ---------------------------------------------------------------------------

create function current_person_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select person_id from user_accounts
  where auth_user_id = auth.uid() and status = 'Active'
  limit 1;
$$;

revoke all on function current_person_id() from public;
grant execute on function current_person_id() to authenticated;

-- ---------------------------------------------------------------------------
-- B.6. Rewire is_admin() / is_hr_or_admin() to the new tables. Signature is
--      UNCHANGED (still takes the raw auth uid) so every existing call site —
--      `is_admin(auth.uid())` in 0002-0007's policies — keeps working with no edits.
-- ---------------------------------------------------------------------------

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_accounts ua
    join user_roles ur on ur.person_id = ua.person_id
    join roles r on r.id = ur.role_id
    where ua.auth_user_id = uid
      and ua.status = 'Active'
      and r.name = 'Admin'
  );
$$;

create or replace function is_hr_or_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_accounts ua
    join user_roles ur on ur.person_id = ua.person_id
    join roles r on r.id = ur.role_id
    where ua.auth_user_id = uid
      and ua.status = 'Active'
      and r.name in ('HR', 'Admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- B.7. update_own_biodata() — same signature, now targets persons via
--      current_person_id() instead of `where id = auth.uid()`.
-- ---------------------------------------------------------------------------

create or replace function update_own_biodata(
  p_display_name text,
  p_cnic text,
  p_date_of_birth date,
  p_address text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
) returns void
language sql
security definer
set search_path = public
as $$
  update persons
  set full_name = p_display_name,
      cnic = p_cnic,
      date_of_birth = p_date_of_birth,
      address = p_address,
      emergency_contact_name = p_emergency_contact_name,
      emergency_contact_phone = p_emergency_contact_phone
  where id = current_person_id();
$$;

-- ---------------------------------------------------------------------------
-- B.8. Repoint every existing FK from profiles(id) to persons(id). Column names
--      and constraint names are unchanged (only the REFERENCES target moves) to
--      minimize the app-code diff — except profile_id, renamed to person_id for
--      clarity now that it no longer refers to "profiles".
-- ---------------------------------------------------------------------------

alter table role_permissions
  drop constraint role_permissions_granted_by_fkey,
  add constraint role_permissions_granted_by_fkey foreign key (granted_by) references persons(id);

alter table invited_users
  drop constraint invited_users_invited_by_fkey,
  add constraint invited_users_invited_by_fkey foreign key (invited_by) references persons(id);

alter table educational_documents rename column profile_id to person_id;
alter table educational_documents
  drop constraint educational_documents_profile_id_fkey,
  add constraint educational_documents_person_id_fkey foreign key (person_id) references persons(id) on delete cascade;

alter table dependents rename column profile_id to person_id;
alter table dependents
  drop constraint dependents_profile_id_fkey,
  add constraint dependents_person_id_fkey foreign key (person_id) references persons(id) on delete cascade;

alter table insurance_policies rename column profile_id to person_id;
alter table insurance_policies
  drop constraint insurance_policies_profile_id_fkey,
  add constraint insurance_policies_person_id_fkey foreign key (person_id) references persons(id) on delete cascade;

alter table audit_log
  drop constraint audit_log_actor_id_fkey,
  add constraint audit_log_actor_id_fkey foreign key (actor_id) references persons(id) on delete set null;

alter table announcements
  drop constraint announcements_created_by_fkey,
  add constraint announcements_created_by_fkey foreign key (created_by) references persons(id) on delete set null;

alter table polls
  drop constraint polls_created_by_fkey,
  add constraint polls_created_by_fkey foreign key (created_by) references persons(id) on delete set null;

alter table poll_votes
  drop constraint poll_votes_voter_id_fkey,
  add constraint poll_votes_voter_id_fkey foreign key (voter_id) references persons(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- B.9. Update RLS policies that referenced profile_id = auth.uid() / voter_id = auth.uid()
--      directly — these must now compare against current_person_id(), because
--      auth.uid() is the AUTH USER id, and persons.id is no longer the same value
--      for accounts created after this migration.
-- ---------------------------------------------------------------------------

drop policy "educational_documents select own" on educational_documents;
drop policy "educational_documents insert own" on educational_documents;
drop policy "educational_documents delete own" on educational_documents;
create policy "educational_documents select own" on educational_documents
  for select to authenticated using (person_id = current_person_id());
create policy "educational_documents insert own" on educational_documents
  for insert to authenticated with check (person_id = current_person_id());
create policy "educational_documents delete own" on educational_documents
  for delete to authenticated using (person_id = current_person_id());

drop policy "dependents select own" on dependents;
drop policy "dependents insert own" on dependents;
drop policy "dependents update own" on dependents;
drop policy "dependents delete own" on dependents;
create policy "dependents select own" on dependents
  for select to authenticated using (person_id = current_person_id());
create policy "dependents insert own" on dependents
  for insert to authenticated with check (person_id = current_person_id());
create policy "dependents update own" on dependents
  for update to authenticated using (person_id = current_person_id()) with check (person_id = current_person_id());
create policy "dependents delete own" on dependents
  for delete to authenticated using (person_id = current_person_id());

drop policy "insurance_policies select own" on insurance_policies;
create policy "insurance_policies select own" on insurance_policies
  for select to authenticated using (person_id = current_person_id());

drop policy "poll_votes select own or hr_or_admin" on poll_votes;
create policy "poll_votes select own or hr_or_admin" on poll_votes
  for select to authenticated
  using (voter_id = current_person_id() or is_hr_or_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- B.10. cast_poll_vote() inserted voter_id = auth.uid() directly — same problem
--       as the policies above. Fix the function body.
-- ---------------------------------------------------------------------------

create or replace function cast_poll_vote(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from polls where id = p_poll_id and status = 'Open') then
    raise exception 'This poll is closed.';
  end if;

  if not exists (select 1 from poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'Invalid option for this poll.';
  end if;

  insert into poll_votes (poll_id, option_id, voter_id)
  values (p_poll_id, p_option_id, current_person_id())
  on conflict (poll_id, voter_id)
  do update set option_id = excluded.option_id, voted_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- B.11. RLS on the three new tables
-- ---------------------------------------------------------------------------

alter table persons enable row level security;
alter table user_accounts enable row level security;
alter table user_roles enable row level security;

create policy "persons select own or admin" on persons
  for select to authenticated using (id = current_person_id() or is_admin(auth.uid()));
create policy "persons insert by admin" on persons
  for insert to authenticated with check (is_admin(auth.uid()));
create policy "persons update by admin" on persons
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy "user_accounts select own or admin" on user_accounts
  for select to authenticated using (person_id = current_person_id() or is_admin(auth.uid()));
create policy "user_accounts insert by admin" on user_accounts
  for insert to authenticated with check (is_admin(auth.uid()));
create policy "user_accounts update by admin" on user_accounts
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy "user_roles select own or admin" on user_roles
  for select to authenticated using (person_id = current_person_id() or is_admin(auth.uid()));
create policy "user_roles admin write" on user_roles
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- B.12. Drop profiles — commented out for now (safety margin). Uncomment and run as its own
--       migration (0009_drop_profiles.sql) only after: the app-code changes that stop reading
--       `profiles` are deployed, the backfill counts in step B.4 have been verified, and this
--       has been soaked in staging. profiles has zero readers left in app code as of this
--       migration.
-- ---------------------------------------------------------------------------

-- drop table profiles;
