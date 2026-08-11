-- Employee Portal — Employee Profile module (F-05/F-06/F-09/F-10), SCR-04/SCR-05.
-- F-07 (HR verifies documents) and F-11 (HR approves dependents) are Should-priority and
-- explicitly out of scope this pass: verification_status/dependents.status are written once on
-- insert (their column DEFAULT) and never transitioned by any policy or function here.

-- ---------------------------------------------------------------------------
-- profiles: biodata + employment-info columns
-- ---------------------------------------------------------------------------

alter table profiles
  add column employee_code text unique,       -- Admin/HR-set, employment info, read-only to employee
  add column designation text,                 -- Admin/HR-set
  add column date_of_joining date,             -- Admin/HR-set
  add column cnic text,                         -- employee-editable biodata
  add column date_of_birth date,                -- employee-editable biodata
  add column address text,                      -- employee-editable biodata
  add column emergency_contact_name text,       -- employee-editable biodata
  add column emergency_contact_phone text;      -- employee-editable biodata

-- ---------------------------------------------------------------------------
-- update_own_biodata(): security-definer self-edit path (mirrors is_admin()'s pattern).
--
-- A blanket "for update using (auth.uid() = id)" policy on profiles is NOT used here — RLS is
-- row-level only, so it would let a caller also smuggle role_id/status/department changes into
-- the same UPDATE. Column-level GRANT UPDATE (...) was considered and rejected too: every
-- Supabase caller connects as the same Postgres `authenticated` role regardless of app-level
-- role, so a column grant would apply uniformly and break Admin's ability to update
-- role_id/status/etc. for *other* users via "profiles update by admin". Instead: a
-- security-definer function hard-coded to touch exactly these six columns, scoped to
-- `where id = auth.uid()` derived server-side inside the function body (never client-supplied).
-- No new blanket self-update RLS policy on profiles is added at all — this function is the only
-- self-edit path. display_name is included (spec lists "name" under editable Personal Info,
-- distinct from the read-only Employment Info fields).
-- ---------------------------------------------------------------------------

create function update_own_biodata(
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
  update profiles
  set display_name = p_display_name,
      cnic = p_cnic,
      date_of_birth = p_date_of_birth,
      address = p_address,
      emergency_contact_name = p_emergency_contact_name,
      emergency_contact_phone = p_emergency_contact_phone
  where id = auth.uid();
$$;

revoke all on function update_own_biodata(text, text, date, text, text, text) from public;
grant execute on function update_own_biodata(text, text, date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- educational_documents (F-05/F-09 doc table). Employee can upload/view/delete own rows.
-- No UPDATE policy at all: verification_status is HR-only (future F-07 module) and there is no
-- "edit existing document metadata" feature in the spec — upload-new / view-list / delete only.
-- ---------------------------------------------------------------------------

create table educational_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  document_name text not null,
  storage_path text not null,
  verification_status text not null default 'Pending',
  created_at timestamptz not null default now()
);

alter table educational_documents enable row level security;

create policy "educational_documents select own" on educational_documents
  for select to authenticated using (profile_id = auth.uid());

create policy "educational_documents insert own" on educational_documents
  for insert to authenticated with check (profile_id = auth.uid());

create policy "educational_documents delete own" on educational_documents
  for delete to authenticated using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- dependents (F-10/F-11 dependents table). Self-row RLS + a column-level UPDATE grant that
-- excludes `status`, because unlike educational_documents this table needs employees to be able
-- to edit their own rows (name/relationship/etc.) but must never let them touch `status` (which
-- only its own DEFAULT sets, on insert). NOTE: same "authenticated role is shared across
-- app-roles" caveat as update_own_biodata's rejected column-grant path applies here too — this
-- is only safe because there is no competing HR-approval writer yet. Revisit (probably replace
-- with a security-definer function, same pattern as update_own_biodata) once F-11 adds one.
-- ---------------------------------------------------------------------------

create table dependents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  relationship text not null,
  cnic_or_bform text,
  date_of_birth date,
  supporting_document_path text,
  status text not null default 'Pending HR Approval',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dependents enable row level security;

create trigger dependents_set_updated_at
  before update on dependents
  for each row execute function set_updated_at();

create policy "dependents select own" on dependents
  for select to authenticated using (profile_id = auth.uid());

create policy "dependents insert own" on dependents
  for insert to authenticated with check (profile_id = auth.uid());

create policy "dependents update own" on dependents
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "dependents delete own" on dependents
  for delete to authenticated using (profile_id = auth.uid());

-- Column-level grant: RLS's `with check` above only constrains *which rows*, not *which
-- columns*, so without this an employee could self-approve a dependent via a crafted PATCH
-- setting `status`. Table-level UPDATE is already granted to `authenticated` by Supabase's
-- default privileges; narrow it to the employee-editable columns only.
revoke update on dependents from authenticated;
grant update (name, relationship, cnic_or_bform, date_of_birth, supporting_document_path)
  on dependents to authenticated;

-- ---------------------------------------------------------------------------
-- insurance_policies (SCR-05 policy summary). Read-only to the employee; HR/Admin populate it
-- directly via the Supabase Table Editor for now (dashboard connects as postgres/service-role,
-- bypasses RLS) — no write path from the app this pass, confirmed with the user.
-- ---------------------------------------------------------------------------

create table insurance_policies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  provider text,
  policy_number text,
  coverage_type text,
  coverage_limit numeric(14, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table insurance_policies enable row level security;

create trigger insurance_policies_set_updated_at
  before update on insurance_policies
  for each row execute function set_updated_at();

create policy "insurance_policies select own" on insurance_policies
  for select to authenticated using (profile_id = auth.uid());
-- No insert/update/delete policy at all: RLS default-denies any command with no matching
-- policy, regardless of table-level grants — this is what makes it genuinely read-only.

-- ---------------------------------------------------------------------------
-- invited_users: carry the 3 new employment-info fields through to first login, same rationale
-- as department/site already being on this table — otherwise an Admin who sets Employee ID /
-- Designation / Date of Joining at invite time would see it silently dropped on first OAuth
-- login. Consumed by app/auth/callback/route.ts.
-- ---------------------------------------------------------------------------

alter table invited_users
  add column employee_code text,
  add column designation text,
  add column date_of_joining date;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket for both educational-document and dependent-support uploads.
-- Path convention: {auth.uid()}/education/{filename}, {auth.uid()}/dependents/{filename}.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;

create policy "employee-documents insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "employee-documents select own folder or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_admin(auth.uid())
    )
  );

-- The is_admin() OR-condition on select is added now (costs nothing) so a future HR/admin
-- document-review screen (F-07) can read files without a new storage migration then.

create policy "employee-documents delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- New route permissions — granted to ALL FOUR roles (every portal user has their own biodata to
-- manage, not just the "Employee" role).
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('route:/profile', 'profile', 'Access own employee profile'),
  ('route:/profile/insurance', 'profile', 'Access own medical insurance & dependents');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where p.key in ('route:/profile', 'route:/profile/insurance');
