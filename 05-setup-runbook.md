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

### 4.1 Create the project

**Overridden 2026-09-16 (see `01-platform-design-and-sop.md` §13): one single Supabase project, shared across all environments** — not the "one project per environment" isolation the SOP originally called for. There's no dev/staging buffer anymore; treat every migration against this project with production-level care. This project already exists and has real usage on it (Admin bootstrap, live login flows all verified working) — it is **not** a fresh/empty project, so don't treat the steps below as a from-scratch setup.

### 4.2 Migrations applied so far, in order

```
supabase/migrations/0001_init_auth.sql
supabase/migrations/0002_admin_module.sql
supabase/migrations/0003_employee_profile.sql
supabase/migrations/0004_departments_sites_audit.sql
supabase/migrations/0005_password_auth.sql
supabase/migrations/0006_company_updates.sql
supabase/migrations/0007_org_hierarchy.sql                                ← applied (original version, see 0008's header comment)
supabase/migrations/0008_org_hierarchy_fix_and_identity_split.sql         ← applied
supabase/migrations/0009_strip_non_core_features.sql                      ← applied
supabase/migrations/0010_permission_groups.sql                            ← applied
supabase/migrations/0011_fix_invited_by_default.sql                       ← applied
```

Either paste each file into the Supabase SQL Editor in order and run it, or place them into `supabase/migrations/` in the repo and run `supabase db push` (or `supabase migration up`) if you're using the Supabase CLI. New migrations from here follow the same convention: new numbered file, never edit a shipped one — see `context.md` §4 for the corrective-migration pattern used a couple of times already (`0011` fixing a stale default `0002` left behind, etc.).

**`profiles` has not been dropped** — `0008`'s final `drop table profiles;` is still commented out. There **are** real logged-in users on this project now, so don't uncomment and run it casually; verify nothing still reads `profiles` (it shouldn't — the app code was migrated alongside `0008`) before doing that as its own follow-up migration.

### 4.3 Configure Auth providers

In **Authentication → Providers**:
- Enable **Azure (Microsoft)** — you'll need an Azure AD app registration (separate step in the Azure Portal, done once per environment or shared with multiple redirect URIs registered). Point its redirect URI at the callback URL Supabase shows you (`https://<project-ref>.supabase.co/auth/v1/callback`).
- **Email/Password** is on by default — this backs the `password` auth method already in the schema for no-email contractual accounts (until phone-OTP is built, per the "explicitly out of scope for this pass" note in the refactor instructions).

In **Authentication → URL Configuration** — since it's the one shared project (Section 4.1), this Site URL/redirect list has to cover every environment at once, not just production:
- **Site URL**: your production domain.
- **Redirect URLs**: add `{SITE_URL}/auth/callback` for production, `http://localhost:3000/auth/callback` for local dev, and a wildcard like `https://*.vercel.app/auth/callback` (or your team's specific preview URL pattern) for Vercel Preview deployments — otherwise every PR's preview deployment will fail OAuth login.

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

### 4.7 Set up invite/onboarding email (Microsoft Graph)

Until this is done, `inviteOrUpdateUser`'s email send is best-effort and silently no-ops (see `lib/email/invite.ts`) — inviting/creating users still works, they just don't get an email telling them so. Requires Azure tenant admin access, which only you can do:

1. **Decided 2026-09-16: reuse the existing SSO app registration** rather than creating a separate one — go to it in **Azure Portal → Microsoft Entra ID → App registrations**. (The separate-app-registration approach is more isolated — a leak of this secret now grants both login and mail-send capability — but the Exchange application access policy in step 5 below is what actually bounds the blast radius, so doing that step is not optional if you're reusing the SSO app.)
2. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Send`.** Then **Grant admin consent** for it (button on the same page) — application permissions don't take effect without this.
3. **Certificates & secrets** — reuse the existing client secret if you still have its value, or **New client secret** if not. Copy the secret **value** immediately (shown once) → `MS_GRAPH_CLIENT_SECRET`. The **Application (client) ID** on the Overview page → `MS_GRAPH_CLIENT_ID`. The **Directory (tenant) ID** → `MS_GRAPH_TENANT_ID` (same values already used for the Azure provider config in Supabase, Section 4.3).
4. **Designate a sender mailbox** — a shared mailbox like `no-reply@faujifoods.com` works well (Exchange Admin Center → Mailboxes → Add a shared mailbox; no license needed for send-only use via Graph). Its address → `MS_GRAPH_SENDER_EMAIL`.
5. **Recommended — scope the app to only that mailbox**, so this app registration can't send mail as any other user in the tenant: in Exchange Online PowerShell,
   ```powershell
   New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId no-reply@faujifoods.com -AccessRight RestrictAccess -Description "Employee Portal mailer - restricted to no-reply mailbox"
   ```
   Skipping this step means the app can send as **any** mailbox in the tenant if the client secret ever leaks — treat this as a real "should do," not optional polish.
6. Add all five `MS_GRAPH_*` variables from `.env.local.example` to `.env.local` (dev) and to Vercel's environment variables (Section 5) — same values across all three Vercel environments, since there's only the one Supabase project/tenant now.
7. Test: invite a real address you control from `/admin/users` and confirm the email arrives.

---

## 5. Vercel project setup

- Create **one** Vercel project, connected to the repo's default branch (`main`) for Production.
- Environment variables (Project Settings → Environment Variables), set separately per Vercel environment (**Production**, **Preview**, **Development**):

Since Section 4.1's override means there's only **one** Supabase project now, `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` and all five `MS_GRAPH_*` variables take the **same value in all three Vercel environments** (Production/Preview/Development) — there's no separate staging/dev project to point Preview at anymore. Only `NEXT_PUBLIC_SITE_URL` still genuinely varies per environment:

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | same value | same value | same value |
| `MS_GRAPH_TENANT_ID` / `..._CLIENT_ID` / `..._CLIENT_SECRET` / `..._SENDER_EMAIL` / `..._SENDER_NAME` | same value | same value | same value |
| `NEXT_PUBLIC_SITE_URL` | prod domain | leave blank / use `VERCEL_URL` | `http://localhost:3000` |

Uses Supabase's current key format (Project Settings → API Keys → Publishable key / Secret keys), not the legacy anon/service_role names — same roles, just the modern key pair Supabase now issues by default. Mark `SUPABASE_SECRET_KEY` **and** `MS_GRAPH_CLIENT_SECRET` as **sensitive/encrypted** variables in Vercel — the former bypasses RLS entirely, the latter can send email as your sender mailbox if it leaks.

**Preview deployments now point at the same single (production-serving) Supabase project as everything else** — there's no isolated staging project to point them at anymore. This is the real cost of the single-project override in Section 4.1: a PR preview testing a migration or a data-mutating change is no longer a safe place to do that without touching real data. Treat schema changes tested via Preview deployments with the same care as a direct prod change.
- Add your production custom domain under Project Settings → Domains, and make sure it matches what you set as Supabase's Site URL in Step 4.3.

---

## 6. Verification checklist before handing off to the team

- [ ] Repo folders match Section 1.3's target structure; `services/` no longer exists.
- [ ] `CODEOWNERS` committed with real usernames/teams, branch protection enabled on `main`.
- [x] The single shared Supabase project has migrations `0001`–`0011` applied — confirmed 2026-09-16.
- [x] Auth providers configured; redirect URLs correct, including the Preview wildcard.
- [ ] Real `companies` and `org_units` (with `site_type`, linked to companies via `org_unit_companies`) seeded — not the placeholder row.
- [x] First Admin account bootstrapped and can log in and reach `/admin/users`.
- [ ] Microsoft Graph mailer set up (Section 4.7) and invite emails confirmed arriving.
- [ ] Vercel project connected, env vars set per environment (same values everywhere per Section 5's single-project note).
- [ ] A test PR from a throwaway branch produces a working Preview deployment that can log in — **remember Preview now shares the same live Supabase project**, so this is no longer a fully safe-to-break test.
- [ ] `npm run lint` and `npm run build` both pass locally on the reorganized repo before the first real module PR lands.

Once every box above is checked, the SOP describes a real, working system your team can build against — not just a plan.
