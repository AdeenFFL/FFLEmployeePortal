# Fauji Food Employee Portal — Setup Runbook
**Do this before handing the SOP to the team.** Order matters — later steps assume earlier ones are done.

---

## 1. Reorganize the repo directory to match module ownership

The SOP (Section 9.1) says each team owns exactly one folder: `app/(protected)/<module>/`. The current repo doesn't quite match that yet, so folder-ownership review can't be enforced literally on day one unless you fix this first.

### 1.1 Moves to make now (clear-cut)

| Current path | Move to | Why |
|---|---|---|
| `app/(protected)/mess/fair-price-shop/` | `app/(protected)/fps/` | FPS is its own module, not a sub-feature of Mess |
| `app/(protected)/services/hr-contact-directory/` | `app/(protected)/hr/hr-contact-directory/` | HR-owned content |
| `app/(protected)/services/policy-library/` | `app/(protected)/hr/policy-library/` | HR-owned content |
| `app/(protected)/services/employment-letters/` | `app/(protected)/hr/employment-letters/` | HR-owned content |
| `app/(protected)/services/internal-jobs/` | `app/(protected)/hr/internal-jobs/` | HR-owned content |
| `app/(protected)/referrals/` | `app/(protected)/hr/referrals/` | Employee referral program — HR-owned |

After moving, `app/(protected)/mess/` should contain only `menu/` (and whatever else is genuinely Mess-owned), and `app/(protected)/services/` should be empty — delete it once confirmed.

### 1.2 Needs a decision before moving (don't guess silently)

- **`app/(protected)/services/quarter-quest/`** — unclear from the code alone what this is (a gamification/engagement feature?). Ask whoever built it which module owns it, or park it under `app/(protected)/hr/` as a placeholder if it's an employee-engagement feature, pending confirmation.
- **`app/(protected)/requests/`** — this may be a genuine cross-module "employee requests" inbox rather than something one module owns (e.g. it could later aggregate an FPS request, an IT ticket, and an HR request in one list). If that's the intent, it's fine to leave at the top level as a **base-app surface** alongside `admin/`, `profile/`, `company-updates/`, `home/` — but write that decision down explicitly in the module registry doc (Section 12 of the SOP) so it isn't mistaken for an orphaned folder six months from now. If it actually belongs to one module, move it in.

### 1.3 Target end state

```
app/(protected)/
  fps/              ← FPS team
  mess/             ← Mess team
  hse/              ← HSE team (doesn't exist yet — created when that team onboards)
  hr/               ← HR team
  it/               ← IT team
  ai/               ← AI Agent team (doesn't exist yet)
  admin/            ← base app (existing)
  profile/          ← base app (existing)
  company-updates/  ← base app (existing)
  home/             ← base app (existing)
  requests/         ← base app, IF confirmed cross-module per 1.2
```

After moving files, update the two places that reference old paths:
- `lib/auth/route-permissions.ts` — the `ROUTE_PERMISSIONS` map's keys must match the new paths.
- `app/(protected)/sidebar.tsx` (and `topbar.tsx` if it links anywhere) — update nav hrefs.
- Update the corresponding `route:/...` permission `key` values in whichever migration seeded them, or add a new migration that updates `permissions.key` for the moved routes (don't hand-edit an already-applied migration — add `0009_route_reorg.sql` with `update permissions set key = 'route:/fps/fair-price-shop' where key = 'route:/mess/fair-price-shop';` etc.).

---

## 2. Add the CODEOWNERS file

Add `.github/CODEOWNERS` (or `.gitlab/CODEOWNERS` if using GitLab) at the repo root — see the companion file `CODEOWNERS` for ready-to-use content. Fill in the actual GitHub/GitLab usernames or team handles before committing; placeholders won't route reviews.

---

## 3. Repo / branch protection settings

In your Git host's settings for this repo:

- [ ] Protect `main`: no direct pushes, PR required.
- [ ] Require at least 1 approval before merge.
- [ ] Require CODEOWNERS review for changes matching shared paths (this is what makes Section 9.1's "shared files need core-team review" rule actually enforced, not just written down).
- [ ] Require status checks to pass before merge: typecheck, lint, build (wire these as a CI workflow — e.g. GitHub Actions running `npm run lint` and `npm run build` on every PR — if not already present in the repo).
- [ ] (Optional, add later if useful) A `staging` branch as a shared pre-production integration point once modules start depending on each other's data.

---

## 4. Supabase project setup

### 4.1 Create the project(s)

Create at minimum: **one dev project** now, **one staging project** and **one production project** before real users touch this (per the SOP's "one Supabase project per environment" rule — don't share one project across dev/staging/prod).

### 4.2 Run the migrations, in order

Against each project (dev first, then staging, then prod once verified):

```
supabase/migrations/0001_init_auth.sql
supabase/migrations/0002_admin_module.sql
supabase/migrations/0003_employee_profile.sql
supabase/migrations/0004_departments_sites_audit.sql
supabase/migrations/0005_password_auth.sql
supabase/migrations/0006_company_updates.sql
supabase/migrations/0007_org_hierarchy.sql                          ← already applied live
supabase/migrations/0008_org_hierarchy_fix_and_identity_split.sql   ← new, provided separately
```

Either paste each file into the Supabase SQL Editor in order and run it, or place both new files into `supabase/migrations/` in the repo and run `supabase db push` (or `supabase migration up`) if you're using the Supabase CLI — matches the convention the existing migrations already follow.

**Since these are fresh projects with no real users yet**, run `0008` with its final `drop table profiles;` line intact — there's nothing to preserve. (The commented-out-drop / phased approach in that file's header comment only matters if you're applying this to a project that already has real logged-in users, which won't be the case for a fresh dev/staging/prod setup.)

After `0008` runs, apply whatever `0009_route_reorg.sql` you wrote in Step 1.3.

### 4.3 Configure Auth providers

In **Authentication → Providers**:
- Enable **Azure (Microsoft)** — you'll need an Azure AD app registration (separate step in the Azure Portal, done once per environment or shared with multiple redirect URIs registered). Point its redirect URI at the callback URL Supabase shows you (`https://<project-ref>.supabase.co/auth/v1/callback`).
- **Email/Password** is on by default — this backs the `password` auth method already in the schema for no-email contractual accounts (until phone-OTP is built, per the "explicitly out of scope for this pass" note in the refactor instructions).

In **Authentication → URL Configuration**:
- **Site URL**: your production domain for the prod project; `http://localhost:3000` for local dev against the dev project.
- **Redirect URLs**: add `{SITE_URL}/auth/callback` for each environment. For the project backing Vercel Preview deployments, also add a wildcard like `https://*.vercel.app/auth/callback` (or your team's specific preview URL pattern) — otherwise every PR's preview deployment will fail OAuth login.

### 4.4 Storage

The `employee-documents` bucket and its policies are created by `0003`'s migration — nothing extra to do here as long as `0003` ran.

### 4.5 Seed real org data

Replace the placeholder in `0007`:

```sql
update companies set name = 'Fauji Foods Limited' where code = 'FFL';
insert into companies (code, name) values
  ('<CODE>', '<Real sub-company/brand name>');
  -- one row per sub-company/brand
```

Then populate `org_units` with real sites (existing `Department`/`Site` types), setting `site_type` for every `Site` row, and linking each site/department to its company/companies via `org_unit_companies` (many-to-many — see `0008`'s Part A) rather than a single `company_id` column:

```sql
insert into org_unit_companies (org_unit_id, company_id)
select '<org_unit id>', id from companies where code = '<CODE>';
-- one row per (site or department, company) pairing; a shared site gets more than one row.
```

### 4.6 Bootstrap the first Admin account

There's a real chicken-and-egg problem here: creating an account via the admin UI requires already being an Admin. Break it with one manual SQL insert, using the existing invite mechanism (works the same before and after the persons/accounts refactor, since `invited_users` is unchanged):

```sql
insert into invited_users (email, display_name, role_id, status)
select '<first-admin-email>@yourdomain.com', '<Full Name>', id, 'Active'
from roles where name = 'Admin';
```

Then have that person sign in via Microsoft SSO once — the callback route will consume the invitation and grant them Admin on first login. From then on, they provision everyone else through `/admin/users`.

---

## 5. Vercel project setup

- Create **one** Vercel project, connected to the repo's default branch (`main`) for Production.
- Environment variables (Project Settings → Environment Variables), set separately per Vercel environment (**Production**, **Preview**, **Development**):

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | prod project URL | staging project URL | dev project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod publishable key | staging publishable key | dev publishable key |
| `SUPABASE_SECRET_KEY` | prod secret key | staging secret key | dev secret key |
| `NEXT_PUBLIC_SITE_URL` | prod domain | leave blank / use `VERCEL_URL` | `http://localhost:3000` |

Uses Supabase's current key format (Project Settings → API Keys → Publishable key / Secret keys), not the legacy anon/service_role names — same roles, just the modern key pair Supabase now issues by default. Mark `SUPABASE_SECRET_KEY` as a **sensitive/encrypted** variable in Vercel — it bypasses RLS entirely (per `lib/supabase/admin.ts`'s own comment).

- Point **Preview** deployments at the **staging** Supabase project, not production — this is what makes per-PR preview deployments (Section 9.2 of the SOP) a safe place for teams to test against without touching real data.
- Add your production custom domain under Project Settings → Domains, and make sure it matches what you set as Supabase's Site URL in Step 4.3.

---

## 6. Verification checklist before handing off to the team

- [ ] Repo folders match Section 1.3's target structure; `services/` no longer exists.
- [ ] `CODEOWNERS` committed with real usernames/teams, branch protection enabled on `main`.
- [ ] Dev, staging, and prod Supabase projects all have migrations `0001`–`0008` (+ your `0009` route-reorg) applied.
- [ ] Auth providers configured on every environment's Supabase project; redirect URLs correct, including the Preview wildcard.
- [ ] Real `companies` and `org_units` (with `company_id`/`site_type`) seeded — not the placeholder row.
- [ ] First Admin account bootstrapped and can log in and reach `/admin/users`.
- [ ] Vercel project connected, env vars set per environment, Preview points at staging Supabase project, Production points at prod.
- [ ] A test PR from a throwaway branch produces a working Preview deployment that can log in.
- [ ] `npm run lint` and `npm run build` both pass locally on the reorganized repo before the first real module PR lands.

Once every box above is checked, the SOP describes a real, working system your team can build against — not just a plan.
