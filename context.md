# Context: Fauji Food Verticals — Employee Portal

This file is background for anyone (or any AI tool) picking up work on this project without the full conversation history. Read this before touching code or docs.

---

## 1. Who this is for

Fauji Food Verticals is a Pakistani food conglomerate made up of multiple sub-companies/brands (Fauji Foods Limited, Fauji Fresh n Freeze, Fauji Cereals, Fauji Pasta), each operating across multiple physical plant sites, plus a shared Head Office. This isn't a flat single company — the org hierarchy (company → site → department) is a first-class part of the data model, because almost every permission and every module's data needs to be scoped by company/site, not just by individual employee.

**The employment reality that drives most of the hard design decisions:**
- **Permanent staff** — get official M365 tenant emails, log in via Microsoft SSO.
- **Contractual staff** — sometimes get an official email (same SSO path), sometimes don't (need a different login method — password or phone OTP, admin-provisioned, not self-registered).
- **3rd-party / vendor staff** — not on payroll, usually get **no account at all**, but still need to exist in the system (named in an HSE incident, issued a mess meal, etc.) without ever logging in.

Any design that assumes "every person has one account and one role" breaks against this reality. That assumption is the single most important thing to avoid re-introducing anywhere in this system.

---

## 2. What's being built

**Revised 2026-09-14 — re-scoped from the original 6-module plan (see git history) to a minimal base skeleton plus 4 modules, decided this way so the base stays small while each module is configured bottom-up as it's actually designed and built:**

**Base skeleton** (`context.md` §3, this is what exists in the app today outside any module folder):
1. **Users & Role Creation** — permission groups are created within a module (by a module admin), assigned to roles, roles assigned to users.
2. **Sites configuration & site scoping** — companies/org_units/org_unit_companies (already built).
3. **Dashboard** — currently a placeholder (`/home`); becomes real once modules exist to surface data from.
4. **Access to modules** — the `module:<code>` coarse-permission convention (§3).

**Modules** (each gets its own schema, own `app/(protected)/<module>/` folder, built one at a time — HR first):

- **M1 — HR**: (1) anonymous feedback chat with an HRBP, reachable *outside* auth/login, stored and routed to the relevant HRBP(s) by department for them to reply to once logged in; (2) non-anonymous feedback/requests, inside auth, assigned as a ticket to the relevant HR person by category.
- **M2 — IT Service Management**: two broad user classes (IT staff with varying permission groups vs. general employees who raise tickets/requests/ideas); IT onboarding/offboarding; inventory & asset management; a demand system for assets/consumables across sites with approval workflow and full procurement steps.
- **M3 — Mess + Fair Price Shop**: employee purchase & billing (site-scoped); a general-public-sale POS system; shop inventory & meal-cost calculation; a stock-demand system with receiving/gate-pass steps.
- **M4 — HSE**: health & safety incident management and hazard reporting, with HSE users and general-employee users.

Each module team builds their own screens and schema, but every module sits on top of the shared base-skeleton identity/org/roles/permission-groups layer so a person's employment status, role, and site are consistent everywhere.

**Open question, not yet resolved:** the original plan's 6th module, **Central AI Agent** (cross-module employee-facing assistant), is absent from the re-scoped 4-module list above — unclear whether it's dropped, deferred, or just not mentioned in this pass. Don't assume either way; ask before doing anything that depends on it existing or not.

---

## 3. Architecture decisions (already made, don't re-litigate without reason)

- **One Supabase project, one Postgres database, one schema per module** (`core`, `fps`, `mess`, `hse`, `hr`, `it`, `ai`). Not one database per module — that breaks the shared employee table and cross-module RLS.
- **One Next.js app, one Vercel project, one deployment.** Each module is a route-group folder inside the same app (`app/(protected)/<module>/...`), not a separately deployed app. Chosen for cost and operational simplicity over independent per-module deploys — see `01-platform-design-and-sop.md` v0.2 for the full trade-off analysis and what compensates for what you give up (Vercel's per-PR preview deployments, required CI gates, `CODEOWNERS`-enforced folder ownership).
- **Identity is split into three concepts, not one "users" table:**
  - `persons` — universal identity, decoupled from `auth.users`. Anyone the org has a relationship with, whether or not they ever log in.
  - `employees` / employment facts on `persons` — employment_type, contract dates, company, site, designation. Only populated for people actually engaged (permanent/contractual).
  - `user_accounts` — the login layer, links `persons.id` to Supabase's `auth.users.id`. Only exists for people who need to log in. A 3rd-party vendor worker can exist as a `person` with zero `user_accounts` rows.
- **Roles are multi-role and scopable**, not a single `role_id` column: `user_roles` (person_id, role_id, company_id?, site_id?, expires_at?) so "Plant Manager at Site A" can differ from "Plant Manager at Site B," and a person can hold more than one role.
- **`core.has_permission()` / `current_person_id()` helper functions** are what every module's RLS policies and route gating call — no module writes ad-hoc auth logic against raw tables.
- **Sites/departments and companies are many-to-many, not "each site belongs to one company"** (decided 2026-09-08): `org_units` (sites and departments) has no `company_id` column — `org_unit_companies` is a join table instead. Reason: a physical site can be shared by more than one sub-company (a shared plant/warehouse/head-office building), and departments were already documented as "company-specific or shared." Nothing else in the schema derives a person's or transaction's company from their site (`persons`/`user_roles` already carry `company_id` and `site_id` independently), so this has no downstream sync-consistency risk. See `01-platform-design-and-sop.md` Section 3 and `supabase/migrations/0008_org_hierarchy_fix_and_identity_split.sql` Part A (this design superseded `0007`'s original `company_id` column after `0007` was already live — see the 2026-09-09 update below).
- **Permissions split into two naming conventions on the same engine, not two systems** (decided 2026-09-08): `module:<code>` (coarse, core-reviewed — gates whether a person can open a module at all) vs `<module>.<verb>_<object>` (fine-grained, module-team-owned, no core review needed). Both are just rows in the existing `roles`/`permissions`/`role_permissions`/`user_roles` tables, checked through the one `has_permission()` function. Reason: each module team should be able to build and iterate their own in-module feature permissions without coordinating with the other five, while still keeping one Admin UI, one audit log, and one thing for the AI Agent module to query. No new tables needed — `permissions.key`/`permissions.module` already support this. See `01-platform-design-and-sop.md` Section 6 and Section 11 step 4.
- **Cross-module reactions go through an event outbox** (`core.integration_events`), not direct writes into another module's schema. E.g. IT marking someone offboarded fires an event; Mess/FPS/HSE react to it independently via a shared Vercel Cron job that dispatches to each module's own handler.
- **Roles are composed only of permission groups, never raw permissions directly** (decided 2026-09-14, supersedes the "two naming conventions" bullet above — the `module:<code>` vs `<module>.<verb>_<object>` key convention still applies to raw `permissions` rows, but roles no longer grant them directly): `permissions` →(M:N)→ `permission_groups` (module-scoped, named bundle — e.g. "HSE Officer Actions" in module `hse`) →(M:N)→ `roles` → `persons` (via `user_roles`, already company/site-scoped). A DB trigger enforces that a group can only contain permissions from its own module (closes a privilege-escalation path). `has_permission(key)` (security-definer SQL function, mirrors `current_person_id()`) is now the one real implementation of the long-referenced-but-never-built `core.has_permission()` — `proxy.ts` calls it via RPC instead of manually joining permission tables. A "module admin" is just a person holding `<module>.manage_permission_groups`, granted through this same system — no separate concept, and RLS already supports self-service group management by one once a module has one; the admin UI (`/admin/permission-groups`) is Admin-gated for now since no module has a module admin yet. See `supabase/migrations/0010_permission_groups.sql`.
- **HR (M1) gets a real Postgres schema (`hr.*`)** (decided 2026-09-22) — the first module to actually do what §11/§12 of the SOP describe, rather than continuing the flat-`public` pattern the base ended up using. Future modules should follow the same real-schema pattern; the base's flat layout is treated as a one-time historical artifact, not the precedent.

---

## 4. Current state of the actual codebase

There's an existing repo (`FFLEmployeePortal-feature-authentication_j`) with base auth already built: `profiles`, `roles`/`permissions`/`role_permissions`, `invited_users`, `org_units` (Department/Site), `educational_documents`, `dependents`, `insurance_policies`, `audit_log`, `announcements`/`polls`. Migrations `0001`–`0006` are already written.

**Verdict on this code: keep and refactor, do not rewrite.** It's genuinely well built — security-definer functions to avoid RLS recursion (`is_admin`, `is_hr_or_admin`), defense-in-depth `requireAdmin()`/`requireHrOrAdmin()`/`requireActiveUser()` checks on every Server Action even though route gating already covers it, column-level grants preventing mass-assignment privilege escalation, a real append-only audit log, and a clean data-driven route→permission map (`proxy.ts` + `route-permissions.ts`).

**The one structural problem:** `profiles.id` is a hard foreign key to `auth.users(id)`, forcing every person in the system to have a login. That's incompatible with 3rd-party/vendor staff. There's also no `employment_type`, no company hierarchy (only flat `org_units` with Department/Site, no Company level), and `role_id` is a single unscoped column.

The refactor fixes exactly that (identity split, company table, scoped multi-role) and nothing else — no UI redesign, no new admin screens beyond what the data model requires.

**Update 2026-09-08: this refactor has been executed on this branch**, following `04-claude-code-refactor-instructions.md` exactly (all phases A–E). `supabase/migrations/0007_org_hierarchy.sql` and `0008_persons_accounts_split.sql` now exist (0008's final `drop table profiles;` is deliberately left commented out as a safety margin — see the file). Every app-code file that read/wrote `profiles` now reads/writes `persons`/`user_accounts`/`user_roles` instead (`proxy.ts`, `lib/auth/*`, `app/auth/callback/route.ts`, `app/(protected)/admin/users/*`, `app/(protected)/admin/roles/*`, `app/(protected)/profile/*`, `app/(protected)/company-updates/actions.ts`, `lib/admin/org-units.ts`, `types/database.ts`). `npx tsc --noEmit`, `npx eslint`, and `npm run build` all pass clean.

One deviation from the doc worth knowing about: the doc's Phase C code sample for `proxy.ts` only checked `user_accounts.status`, but `requireAdmin()`/`requireHrOrAdmin()`/`requireActiveUser()` (per the doc's own Phase B) check both `user_accounts.status` and `persons.status` — and the doc's own manual-test checklist says status now "lives on persons." Treated the Phase C sample as an oversight and made `proxy.ts` check both, so a status change is enforced consistently everywhere.

**Update 2026-09-09: corrected a mistake in how the migration files were maintained.** `0007_org_hierarchy.sql` had been edited in place (see the many-to-many org/company decision below) on the assumption it hadn't been applied to any real database yet — wrong. The user confirmed via a live schema dump that `0007`'s *original* version (single `org_units.company_id` column) had already been run against the actual Supabase project, while `0008` (the identity split) had not. `0007` has been restored to match what's actually live — the repo must not describe history that didn't happen. The org-hierarchy fix (many-to-many `org_unit_companies`, dropping the now-superseded `company_id` column) and the full identity split are now combined into one migration, `supabase/migrations/0008_org_hierarchy_fix_and_identity_split.sql`, written against the exact confirmed current state of the live database (companies/company_id/site_type exist; org_unit_companies/persons/user_accounts/user_roles do not). **This file is not idempotent and not safe to re-run** — it assumes that exact starting state. If the live schema changes before it's run, re-verify with the schema-dump/information_schema check first (see the migration's own header comment).

One accepted, flagged gap: `profiles.department`/`site` (free text) have no destination on `persons` (`company_id`/`site_id` are proper FKs, not populated by the backfill — see the migration's step-4 comment) and were dropped from the admin/users form for this pass rather than half-wiring an FK picker inconsistent with `invited_users`, which still has free-text `department`/`site` untouched by 0008. Re-assigning company/site per person, and building the picker, is explicit fast-follow work (already listed as out-of-scope-for-this-pass in the instructions doc, Section 6).

**Not yet done / needs a human with real infrastructure access:** the migrations have not been run against an actual Supabase project (none exists yet — see `05-setup-runbook.md`), so the doc's Section 7 manual test checklist (login flows, status changes blocking login, document upload storage-path correctness, etc.) is still unverified against a live database. Do that as part of running the setup runbook.

**Update 2026-09-14 (superseded — a real Supabase project now exists and the app has been run against it live):** `0007` and `0008` above were in fact applied to a real project during this stretch (see the 2026-09-09 update for how `0007`'s drift was caught and corrected) — first login, Admin bootstrap, and the full identity-split flow were all verified working end-to-end in the actual running app, not just in theory.

**Update 2026-09-14: base-skeleton strip + permission groups.** Following the re-scope in §2, removed everything outside the base skeleton and the (not-yet-built) 4 modules: `profile/insurance` (dependents/insurance), the "Educational Documents" sub-feature of `/profile`, `company-updates` (announcements/polls), `referrals`, `services/employment-letters`, and the old placeholder `mess/fair-price-shop` + `mess/menu` stubs — both the routes/components and their underlying tables (migration `0009_strip_non_core_features.sql`). `services/internal-jobs`, `policy-library`, `quarter-quest`, and `hr-contact-directory` were relocated (not deleted) into `app/(protected)/hr/` as unwired reference material for when the HR module design doc gets written — they're not linked from nav and have no route-permission entry, reachable only by direct URL. `hr/dashboard` and `it/dashboard` stay as-is. `is_admin()`/`is_hr_or_admin()` and the `employee-documents` storage bucket were deliberately NOT dropped — generic infra every future module will reuse. Also built the permission-groups layer (§3) — migration `0010_permission_groups.sql`, plus a new `/admin/permission-groups` screen (list/create/rename/delete groups, toggle which permissions belong to a group, add new permission keys inline) and a reworked `/admin/roles` (toggles groups now, not raw permissions). Along the way, fixed two pre-existing latent bugs surfaced by this rework: (1) `roles` had no RLS write policy at all despite `admin/roles/actions.ts` already doing insert/update/delete on it — would have failed under RLS the first time someone actually clicked Duplicate/Rename/Delete; (2) `role_permissions.granted_by` defaulted to `auth.uid()`, which stopped being a valid `persons.id` after the 0008 identity split — `role_permission_groups.granted_by` has no default and callers now pass the resolved person id explicitly. `tsc`/`eslint`/`npm run build` all pass clean; **migrations `0009` and `0010` have not yet been run against the live database** — do that next, in order, before testing any of this in the running app.

**Update 2026-09-15: UI polish, invite/onboarding audit, and Graph-based invite email.** Three things:
1. Fixed a real bug found while testing invites: `invited_users_invited_by_fkey` violated on every Microsoft-path invite, because `invited_users.invited_by`'s `DEFAULT auth.uid()` (from 0002, back when `invited_by` pointed at `profiles(id) = auth.users(id)`) was never updated when 0008 repointed the FK at `persons(id)` — same bug class as `role_permissions.granted_by`, just missed the first time. Fixed the call site to pass `invited_by` explicitly and added `0011_fix_invited_by_default.sql` to drop the stale default.
2. **Audited the full invite/auth flow** (asked: "how does the employee receive an invitation") — finding: **they don't, nothing has ever emailed anyone**. Microsoft-path invites just stage a row in `invited_users`; the admin has to separately tell the employee out-of-band to sign in. Password-path accounts are created immediately with the UI's own copy admitting "you must share this password with the employee directly." This was a known, deliberate gap in the original build (README/forgot-password page both said so explicitly), not something introduced later.
3. Built the fix for that gap: **Microsoft Graph-based invite email** (`lib/email/graph-client.ts`, `lib/email/invite.ts`) — chosen over a third-party ESP since the org already has an Azure AD tenant for SSO; reuses that pattern instead of adding a vendor. `inviteOrUpdateUser()` now sends a branded email with a portal login link on fresh invites/account creation (best-effort — a delivery failure never blocks provisioning, logged into the audit trail instead); added a "Resend Invite" button for pending Microsoft invitations. **Not yet functional** — needs the `MS_GRAPH_*` env vars, which need real Azure setup only the user can do; until then it silently no-ops.

Also fixed a UI performance issue: every admin overlay (Modal, the `/admin/users` slide-over) closed via a `<Link>` to a plain URL, which made Next.js re-run the *entire* page's data fetching (several sequential Supabase calls) just to dismiss the overlay — visibly sluggish. Closing now uses local client state (`components/use-dismissable.ts`) for instant dismissal, syncing the address bar via `history.replaceState` (no Next.js navigation, so nothing to wait on).

**Note on branches:** the repo has `adeen` and `feature/invite` — at one point `adeen` fell behind (a chunk of committed work, including the rebrand and the collapsible sidebar, only existed on `feature/invite`), which looked like data loss until the branches were sorted out. As of 2026-09-22, active work is on `feature/invite`. Check `git branch --show-current` before assuming which branch has the latest state if this ever looks confusing again — don't assume `adeen` is current just because it's the "main-sounding" name.

**Update 2026-09-16: two infrastructure decisions, both overriding what the SOP originally called for.**
1. **The Graph mailer reuses the existing SSO Azure AD app registration**, not a separate one as §4.7 originally recommended — user's explicit choice, weighing the convenience of one app registration to manage against the security margin of two. The Exchange application access policy scoping it to one sender mailbox (§4.7 step 5) is what actually bounds the risk of reuse, so that step is now load-bearing, not optional polish. `05-setup-runbook.md` §4.7 updated to describe the reuse path.
2. **Single shared Supabase project across all environments** (dev/staging/prod), overriding `01-platform-design-and-sop.md` §13's original "one project per environment" rule. Real cost being accepted: no isolated environment left to test a destructive migration or a data-mutating change against before it touches the same data everything else uses — Vercel Preview deployments now point at the same live project too. `01-platform-design-and-sop.md` §13 and `05-setup-runbook.md` §4.1/§5/§6 updated to reflect this; the original multi-project text is kept struck through in §13 rather than deleted, so the reasoning that motivated it isn't lost if this gets revisited once real users are on the system.

---

## 5. Documents produced so far (reference these, don't regenerate from scratch)

| File | What it is |
|---|---|
| `01-platform-design-and-sop.md` (v0.2) | The full platform design: org model, identity model, employment/auth strategy, RBAC, schema partitioning, RLS approach, single-app architecture SOP, cross-module event pattern, module onboarding SOP, conventions, governance |
| `04-claude-code-refactor-instructions.md` | File-by-file work order for Claude Code to execute the `profiles` → `persons`/`user_accounts`/`user_roles` refactor against the actual existing codebase |
| `0007_org_hierarchy.sql` | **Already applied to the live database.** Adds `companies` table, extends `org_units` with `company_id`/`site_type`. Matches what's actually live — do not edit further; corrections go in a new migration (see below). |
| `0008_org_hierarchy_fix_and_identity_split.sql` | **Applied.** Combined migration: (A) replaces the now-superseded `org_units.company_id` with a many-to-many `org_unit_companies` join table, (B) the core identity-split — creates `persons`/`user_accounts`/`user_roles`, backfills from `profiles`, repoints every existing FK, rewires `is_admin()`/`is_hr_or_admin()`/`update_own_biodata()`/`cast_poll_vote()`. `drop table profiles;` is still commented out — profiles has not been dropped yet. |
| `0009_strip_non_core_features.sql` | **Not yet applied.** Drops `educational_documents`, `dependents`, `insurance_policies`, `announcements`, `polls`/`poll_options`/`poll_votes`, `cast_poll_vote()`, `poll_results()`, and their orphaned route permissions. Part of the base-skeleton re-scope (§2/§4). |
| `0010_permission_groups.sql` | Adds `permission_groups`/`permission_group_permissions`/`role_permission_groups`, `has_permission(key)`, backfills every existing `role_permissions` grant into an equivalent group, then drops `role_permissions`. Also adds the `roles`/`permissions` RLS write policies that were missing before (see §4's 2026-09-14 update). Must run after `0009`. |
| `0011_fix_invited_by_default.sql` | Drops `invited_users.invited_by`'s stale `DEFAULT auth.uid()` (leftover from before the persons/user_accounts split — the FK now points at `persons(id)`, so the default no longer resolves to a valid row). Callers must pass `invited_by` explicitly; `admin/users/actions.ts` already does. |
| `06-hr-module-design.md` | **Design doc, not yet built.** HR module (M1): schema (`hr.*`), ERD, permission codes, RLS, folder plan for both features (anonymous chat, tickets). User is implementing this one themselves to learn the pattern — this doc is the reference, not a work order for Claude Code the way `04-claude-code-refactor-instructions.md` was. |
| `05-setup-runbook.md` | Step-by-step: repo directory reorg (routes are currently misaligned with module ownership — e.g. `fair-price-shop` sits under `mess/`), `CODEOWNERS`, branch protection, Supabase project setup + migration order, Auth provider config, Vercel project + env var setup, admin bootstrap |
| `CODEOWNERS` | Ready-to-use file mapping shared files and module folders to review ownership (needs real usernames filled in) |

---

## 6. Open decisions — not yet resolved, don't assume an answer

- **Central AI Agent module** — absent from the 2026-09-14 re-scoped module list (§2). Dropped, deferred, or just unmentioned? Ask before assuming either way.
- **`app/(protected)/services/quarter-quest/`** — relocated to `app/(protected)/hr/quarter-quest/` as HR-module reference material (2026-09-14), but what it actually *is* is still unresolved — ask before building on it.
- **`app/(protected)/requests/`** — left untouched by the 2026-09-14 strip (wasn't in scope of that decision either way). Possibly a legitimate cross-module "employee requests" inbox (base-app surface, not module-owned), possibly should belong to one module — likely relevant now that M1/M2 both describe ticket-style request flows. Needs an explicit decision, documented in the module registry.
- ~~Anonymous feedback mechanism (M1/HR)~~ **Resolved 2026-09-22: fully anonymous, no recovery, ever** — no identity stored for the submitter at all (not even IP/fingerprint), just an unguessable conversation token for continuity. See `06-hr-module-design.md` §1. Accepted cost: no recourse if abused, no way to loop a submitter back in for a serious situation.
- **Offboarding system of record** — confirm with BAs whether HR or IT actually owns writing employment status (only one module should trigger the lifecycle event) — relevant to M2's onboarding/offboarding scope.

---

## 7. What's next

- **Run `0009_strip_non_core_features.sql`, `0010_permission_groups.sql`, then `0011_fix_invited_by_default.sql`** against the live Supabase project, in that order — the app code already assumes all three have run.
- **Set up the Microsoft Graph mailer app registration** (`05-setup-runbook.md` §4.7) and add the five `MS_GRAPH_*` env vars — invite emails silently no-op until this is done. Needs Azure tenant admin access.
- Once verified in staging, uncomment `drop table profiles;` at the end of `0008_org_hierarchy_fix_and_identity_split.sql` and run it as its own migration.
- Resolve the remaining open decisions in §6 — Central AI Agent (changes whether a 5th module folder is coming), and `/requests` (now genuinely relevant given HR's ticket system, §7 of `06-hr-module-design.md`).
- ~~Write the HR module (M1) design document~~ **Done 2026-09-22** — `06-hr-module-design.md`. Anonymity model and schema-per-module decisions both made (§3 above). User is implementing it themselves from this doc, to learn the pattern.
- M2 (IT Service Management), M3 (Mess + FPS), M4 (HSE) follow after M1, each getting the same design-doc-first treatment.
- `01-platform-design-and-sop.md`'s original 6-module SOP (Section 11 onboarding steps, module registry, etc.) still applies mechanically to onboarding each of the 4 re-scoped modules — it wasn't rewritten for the new module list, just superseded in which modules exist.

---

## 8. Working style / how to engage with this project

- Iterative: produce a baseline artifact, then request targeted revisions (scope changes, specific edits) rather than full rewrites.
- Cost efficiency is an explicit constraint — it's why the single-Vercel-deployment decision was made over per-module deployments.
- Decisions that need team/BA input should be flagged explicitly in deliverables, never silently assumed.
- Formal documents (SOPs, BRDs, runbooks, migrations) are primary deliverables meant for team handoff and stakeholder review, not just chat answers.
