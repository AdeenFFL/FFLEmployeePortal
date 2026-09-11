# FFL Employee Portal — Base Auth Refactor
## Plan & Execution Instructions for Claude Code
**Revision note:** the platform has since been confirmed as a **single Next.js app / single Vercel deployment** (all six modules as route-group folders in one app, not separate deployed apps — see `01-platform-design-and-sop.md` v0.2, Sections 2 & 9). Nothing in this file changes as a result: it was already written against the one app you have today, and every file path/instruction below assumes that same single-app structure. Treat this note as confirmation, not a diff.

**Execution note (2026-09-09):** this work order has been executed — see `context.md` Section 4 for the outcome and the one deviation made (the `proxy.ts` status check in Phase C below was widened to match Phase B). Two things below no longer match the repo exactly, both discovered only after execution: (1) `0007_org_hierarchy.sql` had *already been applied* to the live database by the time this was picked up — see `context.md`'s 2026-09-09 update — so `0007` was left matching what's actually live rather than the org-hierarchy design in Section 3 of the platform doc; (2) the migration this section calls `0008_persons_accounts_split.sql` was combined with the org-hierarchy fix into a single file, `supabase/migrations/0008_org_hierarchy_fix_and_identity_split.sql`, written against the confirmed live schema rather than a blank one. The SQL bodies below are otherwise unchanged and were used as-is.

**Audience:** This file is written to be handed directly to Claude Code as a work order against the existing repo (`FFLEmployeePortal-feature-authentication_j`). It assumes Claude Code has the repo checked out and can read/write files and run `supabase` CLI commands.

**Codebase reviewed:** `supabase/migrations/0001–0006`, `lib/auth/*`, `lib/supabase/*`, `lib/admin/*`, `app/auth/callback/route.ts`, `app/login/actions.ts`, `proxy.ts`, `app/(protected)/*`, `types/database.ts`.

---

## 0. Verdict

**Keep and refactor. Do not rewrite from scratch.**

This codebase is well built: security-definer functions used correctly to avoid RLS self-recursion (`is_admin`, `is_hr_or_admin`), defense-in-depth server-side re-checks on every Server Action (`requireAdmin`, `requireHrOrAdmin`, `requireActiveUser`) even though `proxy.ts` already gates routes, column-level `GRANT`s to stop privilege escalation through mass-assignment (the `dependents.status` case), a genuinely append-only audit log, and a clean data-driven route→permission map. None of that gets thrown away.

**The one structural problem**, consistent with everything reviewed earlier in this project: `profiles.id references auth.users(id)` forces every person in the system to have a Supabase Auth login. That's incompatible with 3rd-party/vendor staff who get no account, and there's no `employment_type`, no multi-company hierarchy, and `role_id` is a single column (no multi-role, no site/company-scoped roles).

This refactor fixes exactly that, and nothing else. It does not redesign the UI, does not add multi-role admin screens, and does not build out company/site management UI beyond what's needed for the data model to be correct. Those are fast-follows once the six modules actually need them.

---

## 1. Do not touch

Preserve these patterns exactly as they are — they're correct and other module teams should copy them, not relearn them:

- The `is_admin(uid uuid)` / `is_hr_or_admin(uid uuid)` security-definer function shape (avoids RLS recursion). Reuse this shape for the new `current_person_id()` helper below.
- `requireAdmin()` / `requireHrOrAdmin()` / `requireActiveUser()` defense-in-depth pattern in `lib/auth/*`.
- The audit log (`audit_log`, `logAuditEvent()`) — untouched structurally; only its FK target changes.
- `ROUTE_PERMISSIONS` / `permissionKeyForPath()` in `lib/auth/route-permissions.ts` — the data-driven route-gating mechanism itself is correct and stays.
- `org_units` table mechanism (Department/Site rows in one table) — extended, not replaced.
- Storage bucket policies in `0003_employee_profile.sql` — these key off the raw Supabase `auth.uid()`, not `profiles.id`. They do **not** need to change (see the storage-path callout in Section 4.6 — this is the easiest thing to get subtly wrong).
- `announcements` / `polls` / `poll_options` / `cast_poll_vote()` / `poll_results()` — logic is unchanged; only the FK target of `created_by` / `voter_id` changes.
- Migration convention already in use: **new numbered migration files, never edit a shipped one.**

---

## 2. Target model (recap, adapted to this repo's naming)

| Old | New | Why |
|---|---|---|
| `profiles` (person + employment + login, forced 1:1 with `auth.users`) | `persons` (identity + employment facts, no auth dependency) + `user_accounts` (login, optional, links to `auth.users`) | Lets a 3rd-party person exist with no login |
| `profiles.role_id` (single FK) | `user_roles` (person_id, role_id, company_id?, site_id?, expires_at?) | Multi-role, scoped-role ready |
| `profiles.department` / `profiles.site` (free text) | `persons.company_id` / `persons.site_id` (FK to `companies` / `org_units`) | Referential integrity, enables scoping |
| *(none)* | `companies` (new table) | Models Fauji Food's multiple sub-companies/brands |
| `auth_method IN ('microsoft','password')` | adds `'phone_otp'` | Covers no-email contractual staff |
| *(none)* | `persons.employment_type`, `contract_start_date`, `contract_end_date` | Your 3-tier employment reality |
| *(none)* | `user_accounts.is_external`, `sponsoring_company_id`, `access_expires_at` | Time-bound scoped vendor accounts |

`roles`, `permissions`, `role_permissions` stay exactly as they are — that part was already right.

---

## 3. Scope decision: hard cutover, no compatibility view

This app has not launched to real users yet. Do **not** build a `profiles` compatibility view or maintain both schemas in parallel — that's extra complexity bought for a migration risk that doesn't exist yet. Drop `profiles` in the same change that updates the app code. If real user rows already exist in a dev/staging Supabase project, the backfill in the migration below carries them over first.

---

## 4. Execution plan

Work through these in order. Don't start Phase B until Phase A's migrations run cleanly against a scratch/staging Supabase project.

### Phase A — Schema

#### A.1 — Create `supabase/migrations/0007_org_hierarchy.sql`

```sql
-- Employee Portal — Org hierarchy: companies (Fauji Food has multiple sub-companies/brands,
-- each with multiple sites — org_units alone can't express that level).
-- Purely additive: no changes to any table, policy, or function from 0001-0006.

create table companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

alter table companies enable row level security;

create policy "companies readable by authenticated" on companies
  for select to authenticated using (true);

create policy "companies admin access" on companies
  for insert to authenticated with check (is_admin(auth.uid()));

create policy "companies admin update" on companies
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Sites belong to a company; shared/central departments can stay unassigned (null).
alter table org_units
  add column company_id uuid references companies(id),
  add column site_type text check (site_type in ('plant','warehouse','shop','head_office','mess','other'));

-- Seed placeholder — replace with real sub-company data before go-live.
insert into companies (code, name) values
  ('FFL', 'Fauji Foods Limited')
on conflict do nothing;
```

Ask the BA team for the real list of sub-companies/brands and replace the placeholder seed before this ships to staging.

#### A.2 — Create `supabase/migrations/0008_persons_accounts_split.sql`

This is the core migration. Full content:

```sql
-- Employee Portal — Identity split: profiles -> persons + user_accounts + user_roles.
-- Rationale: profiles forced every person to have an auth.users row, which cannot represent
-- 3rd-party/vendor staff who get no login, had no employment_type, and allowed only one role
-- per person with no company/site scoping. See project docs for full rationale.
--
-- Cutover approach: this app has no production users yet, so this migration backfills any
-- existing profiles rows and then drops profiles outright in the same migration. If you are
-- running this against a project with real users you care about, verify the backfill counts
-- (step 4 below) before letting the DROP TABLE at the end run.

-- ---------------------------------------------------------------------------
-- 1. persons — universal identity, decoupled from auth.users
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
-- 2. user_accounts — login layer, optional, links to auth.users
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
-- 3. user_roles — replaces profiles.role_id (single, unscoped) with multi-role,
--    optionally company/site-scoped assignment.
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
-- 4. Backfill from profiles (reuses profiles.id as persons.id so every existing
--    FK — role_permissions.granted_by, invited_users.invited_by, educational_documents,
--    dependents, insurance_policies, audit_log, announcements, polls, poll_votes —
--    can be repointed with zero value remapping in step 5).
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

-- Verify before proceeding:
--   select count(*) from profiles;       -- N
--   select count(*) from persons;        -- must equal N
--   select count(*) from user_accounts;  -- must equal N

-- ---------------------------------------------------------------------------
-- 5. current_person_id() — the one helper every RLS policy and RPC below uses
--    to go from auth.uid() -> persons.id. Mirrors is_admin()'s security-definer
--    shape to avoid RLS self-recursion on persons/user_accounts.
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
-- 6. Rewire is_admin() / is_hr_or_admin() to the new tables. Signature is
--    UNCHANGED (still takes the raw auth uid) so every existing call site —
--    `is_admin(auth.uid())` in 0002-0006's policies — keeps working with no edits.
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
-- 7. update_own_biodata() — same signature, now targets persons via
--    current_person_id() instead of `where id = auth.uid()`.
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
-- 8. Repoint every existing FK from profiles(id) to persons(id). Column names
--    and constraint names are unchanged (only the REFERENCES target moves) to
--    minimize the app-code diff — except profile_id, renamed to person_id for
--    clarity now that it no longer refers to "profiles". See Section 4.6 for
--    the app-code impact of this rename.
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
-- 9. Update RLS policies that referenced profile_id = auth.uid() / voter_id = auth.uid()
--    directly — these must now compare against current_person_id(), because
--    auth.uid() is the AUTH USER id, and persons.id is no longer the same value
--    for accounts created after this migration.
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
-- 10. cast_poll_vote() inserted voter_id = auth.uid() directly — same problem
--     as the policies above. Fix the function body.
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
-- 11. RLS on the three new tables
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
-- 12. Drop profiles. Run this only after the app-code changes in Section 4 of
--     the plan doc are deployed alongside this migration — profiles has zero
--     readers left at that point.
-- ---------------------------------------------------------------------------

drop table profiles;
```

**Before running step 12 in any environment with real invited/logged-in users:** confirm the counts in the comment under step 4 match, and confirm the app deploy that stops reading `profiles` is going out in the same release. If you want a safety margin, comment out the final `drop table profiles;` line, deploy the app changes, verify in staging for a day, then run the drop as its own one-line migration.

---

### Phase B — Server-side identity helpers (`lib/auth/*`)

#### B.1 — `lib/auth/require-admin.ts`, `lib/auth/require-hr-or-admin.ts`, `lib/auth/require-user.ts`

All three currently do: `select from profiles where id = user.id`. Replace with a join through `user_accounts` → `persons`, and resolve role name(s) via `user_roles` → `roles` instead of the single `role_id` column.

New shared shape for all three (adjust return values to match what each currently exposes — `adminProfileId` becomes `personId`, etc., propagate the rename through every call site found in Phase D):

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) throw new Error("Not authenticated");

const { data: account } = await supabase
  .from("user_accounts")
  .select("person_id, status, persons(full_name, personal_email, status)")
  .eq("auth_user_id", user.id)
  .maybeSingle();

if (!account || account.status !== "Active" || account.persons?.status !== "Active") {
  throw new Error("Forbidden");
}

const { data: roleRows } = await supabase
  .from("user_roles")
  .select("roles(name)")
  .eq("person_id", account.person_id);

const roleNames = (roleRows ?? []).map(r => r.roles?.name).filter(Boolean);
```

- `requireAdmin()`: require `roleNames.includes("Admin")`.
- `requireHrOrAdmin()`: require `roleNames.includes("HR") || roleNames.includes("Admin")`, and build `actorLabel` from whichever of the two is present (mirror current logic).
- `requireActiveUser()`: no role check, same as today — just return `{ supabase, personId: account.person_id }` (rename `userId` → `personId`).

#### B.2 — `app/(protected)/current-user.ts`

Same transform: look up `user_accounts` by `auth_user_id`, then `user_roles`/`roles` for role name(s). For `ROLE_HOME_PATH` lookup with potentially multiple roles now possible, pick the first match in this priority order (define as a new exported array in `lib/auth/roles.ts`, e.g. `ROLE_PRIORITY = ["Admin", "HR", "IT", "Employee"]`) — this only matters once a person is ever given more than one role, which isn't exposed in the admin UI yet (see Section 6), but the helper should be correct now rather than assuming exactly one role forever.

#### B.3 — `lib/auth/roles.ts`

Add the `ROLE_PRIORITY` array described above. `ROLE_HOME_PATH` and `DEFAULT_HOME_PATH` are unchanged.

---

### Phase C — Route gating (`proxy.ts`)

Current logic reads `profiles.role_id` once, then checks one `role_permissions` row per protected route. New logic must aggregate across **all** roles the person holds (any one of them granting the permission is enough — this is a standard any-of-N-roles RBAC check, not a scope check; site/company scoping is a module-level RLS concern, not a route-gate concern, per Section 2 of the base platform design doc).

Replace the single-role lookup block with:

```ts
const { data: account } = await supabase
  .from("user_accounts")
  .select("person_id, status")
  .eq("auth_user_id", user.id)
  .maybeSingle();

const personId = account?.person_id ?? null;
const accountStatus = account?.status ?? "Active";

if (accountStatus !== "Active") {
  // same "inactive" redirect as today
}

if (!personId) {
  // shouldn't happen once callback route always creates an account — treat as pending
}

const { data: roleRows } = await supabase
  .from("user_roles")
  .select("role_id, roles(name)")
  .eq("person_id", personId);

const roleIds = (roleRows ?? []).map(r => r.role_id);
const roleNames = (roleRows ?? []).map(r => r.roles?.name).filter(Boolean);

if (roleIds.length === 0) {
  // same "/pending-setup" redirect as today
}
```

For the permission check itself, replace the single `.eq("role_id", roleId)` lookup with `.in("role_id", roleIds)` against `role_permissions`, and allow through if any row matches.

For the "authenticated user hitting /login or /pending-setup" redirect, use `ROLE_PRIORITY` (Section B.3) against `roleNames` to pick the home path, falling back to `/home` as today.

---

### Phase D — First-login provisioning (`app/auth/callback/route.ts`)

This is the most-changed file. Today it inserts one `profiles` row on first login, pulling role/department/site/employment fields from a matching `invited_users` row if present. It must now insert into **three** tables:

1. `persons` — `full_name`, `status`, `employee_code`, `designation`, `date_of_joining`, plus company/site if the invite specifies them.
2. `user_accounts` — `person_id`, `auth_user_id: user.id`, `email: normalizedEmail`, `auth_method: 'microsoft'`, `last_login_at: now()`.
3. `user_roles` — one row per role granted at invite time (today's flow only ever grants one; keep it to one row for now, sourced from `invitation.role_id`).

Use the **service-role client** (`createAdminClient()`) for all three inserts, same justification as today (a brand-new user has no `person_id` yet to satisfy any self-scoped RLS policy). Wrap the three inserts in a transaction if the Supabase client library in use supports it in this context; if not, insert `persons` first, then `user_accounts`, then `user_roles`, and on any failure after the first insert, delete the rows already created before returning the `provisioning_failed` redirect — don't leave an orphaned `persons` row with no account.

On subsequent logins (the `else` branch, profile already exists): update `user_accounts.last_login_at` instead of `profiles.last_login_at`, matched on `auth_user_id = user.id`.

For determining `homePath` at the end: same `ROLE_PRIORITY` lookup as Phase C, against the roles just resolved from `user_roles`.

---

### Phase E — Everything else that reads/writes `profiles` directly

Grep hits and what each needs:

| File | Change |
|---|---|
| `app/login/actions.ts` (`recordPasswordLogin`) | Update `user_accounts.last_login_at` where `auth_user_id = user.id`, not `profiles` where `id = user.id`. |
| `app/unauthorized/page.tsx` | Same lookup transform as `current-user.ts` (Phase B.2) to get `displayName` / `roleName`. |
| `app/(protected)/admin/users/actions.ts` | Biggest app-code file to touch. `inviteOrUpdateUser`: existing-user branch now updates `persons` (biodata/employment fields) separately from `user_accounts` (status) and `user_roles` (role — delete-then-insert the one row, since the UI still assigns exactly one role per person for now, per Section 6). New-password-account branch: insert `persons`, then `user_accounts` with `auth_method: 'password'`, then `user_roles`. `setUserPassword` / `setUserStatus` / `revokeInvitation`: repoint each `profiles` lookup to the equivalent `persons` / `user_accounts` table. Add an `employment_type` field to the form fields read in `readUserFormFields()` — every new person needs one. |
| `app/(protected)/admin/users/page.tsx`, `user-form.tsx` | Update the query that lists users to join `persons` + `user_accounts` + `user_roles` + `roles` instead of selecting from `profiles`. Add an `employment_type` `<select>` to the form (values: the four enum options from `0008`'s check constraint). Existing `department`/`site` free-text inputs should become `<select>`s bound to `org_units`/`companies` once Phase F below is scheduled — not required for this pass, but flag it as a known gap in the PR description rather than silently leaving free text in place. |
| `app/(protected)/admin/roles/page.tsx`, `actions.ts` | No structural change — these operate on `roles`/`permissions`/`role_permissions`, which are untouched. Only touch these if they happen to join through `profiles` anywhere (check `granted_by` display). |
| `app/(protected)/profile/page.tsx`, `actions.ts` | `updateOwnBiodata()` already calls the `update_own_biodata` RPC — no change needed there (Phase A.2 step 7 handles it server-side). `requireActiveUser()` now returns `personId` instead of `userId` — propagate the rename. **Storage path callout:** `uploadEducationalDocument` builds the storage path as `` `${userId}/education/...` `` and also inserts that same `userId` as the document's owner FK. After this refactor those must be **two different values** — the storage path must keep using the raw Supabase auth id (`user.id` from `supabase.auth.getUser()`), because the storage bucket policies check `(storage.foldername(name))[1] = auth.uid()::text` and are not being changed (Section 1). The `person_id` column on `educational_documents`, however, must be the resolved `person_id`. Fetch both values in this function (`requireActiveUser()` should return `{ supabase, personId, authUserId }`) and use each in its correct place — mixing them up will not throw an error for existing backfilled users (their ids happen to coincide) but will break for every person created after this migration ships. |
| `app/(protected)/profile/insurance/actions.ts`, `dependent-form.tsx` | Same `person_id` vs. `auth_user_id` distinction as above for the dependent-document upload path. |
| `types/database.ts` | Rewrite by hand (or generate) to reflect `persons`, `user_accounts`, `user_roles`, `companies`, and the `person_id`-renamed columns on `educational_documents`/`dependents`/`insurance_policies`; remove the `Profile` type. Once a real Supabase project is up, replace this whole file per the comment already at its top: `npx supabase gen types typescript --project-id <ref> > types/database.ts`. |

---

## 5. Sequencing

1. Write and apply `0007_org_hierarchy.sql` and `0008_persons_accounts_split.sql` (with the final `drop table profiles;` commented out) against a scratch Supabase project.
2. Verify backfill counts (see the comment in step 4 of `0008`).
3. Make all Phase B–E code changes on a branch.
4. Point the branch's `.env.local` at the scratch project, run through the full manual test list below.
5. Once green, uncomment the `drop table profiles;` line, re-apply, retest.
6. Regenerate `types/database.ts` from the now-final schema.
7. Merge.

---

## 6. Explicitly out of scope for this pass

Don't do these now — they're real gaps but belong to a later, focused pass once a module actually needs them:

- Multi-role admin UI (assigning more than one role to a person). The schema supports it; the `/admin/users` form still assigns exactly one.
- Site/company **scoped** roles in the admin UI (`user_roles.company_id` / `site_id` populated as non-null). Route-level gating in this pass is still "does the person hold this role anywhere," not "at this site" — that granularity is a module-level RLS concern per the base platform design doc, not this base app's.
- Phone-OTP sign-in flow and the admin UI to provision no-email contractual accounts. The schema (`auth_method = 'phone_otp'`) is ready for it; the actual Supabase Auth phone provider config and UI are a separate ticket.
- Converting `persons.department`/site free text (where still present) into full FK-based pickers everywhere.
- Anything in the six downstream modules (FPS, Mess, HSE, HR feedback, IT, AI) — this file only covers the shared base.

---

## 7. Manual test checklist before merging

- [ ] Existing (backfilled) Microsoft-OAuth user can still log in and lands on their correct role home.
- [ ] Existing password-auth user can still log in via `/login` with password.
- [ ] Brand-new email logs in via Microsoft OAuth with no `invited_users` row → lands on `/pending-setup`, and a `persons` + `user_accounts` row now exists with no `user_roles` row.
- [ ] Brand-new email with a matching `invited_users` row → lands on the correct role home, and `persons` + `user_accounts` + one `user_roles` row all exist, and the `invited_users` row is deleted.
- [ ] Admin creates a new password-based account end-to-end (Section D.'s new-password-account branch) → same three-table result.
- [ ] Setting a person's status to `Suspended` blocks their next login (`/unauthorized?reason=inactive`) — verify this still works when `status` lives on `persons`, not `profiles`.
- [ ] `/profile` biodata edit still works (`update_own_biodata` RPC).
- [ ] Uploading an educational document: file lands in the correct storage path (`{auth_user_id}/education/...`) **and** the `educational_documents.person_id` row is correct — this is the case most likely to silently break per the Section E callout.
- [ ] Dependents: add/edit own dependent still works; still cannot self-set `status` (column-level grant still excludes it — verify the grant statement in `0003` still applies post-rename, since `revoke/grant` target column names by name and `profile_id`→`person_id` isn't one of the granted columns anyway).
- [ ] Poll voting (`cast_poll_vote`) and results (`poll_results`) work correctly with the new `voter_id` resolution.
- [ ] Audit log still records actor correctly (check `audit_log.actor_id` resolves to a real `persons` row and `actor_label` still renders in the admin UI).
- [ ] `/admin/users` list page renders correctly joining the new tables, and the edit form round-trips role/status/employment_type changes.
- [ ] A person with `person_type = 'third_party'` and no `user_accounts` row can be inserted directly (as Admin/service-role) without violating any constraint — this is the actual capability this whole refactor exists to unlock, confirm it before calling this done.
