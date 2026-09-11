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

A single **Employee Portal** covering six modules, developed by separate teams but sharing one identity/auth foundation:

1. **Fair Price Shop (FPS) Management**
2. **Mess Management**
3. **Health, Safety & Environment (HSE)**
4. **HR Documentation & Anonymous Feedback**
5. **IT Onboarding/Offboarding + Service Desk + Inventory**
6. **Central AI Agent** — cross-module employee-facing assistant

Each module team builds their own screens and their own database schema, but all six sit on top of one shared identity/org/roles layer so a person's employment status, role, and site are consistent everywhere.

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

---

## 5. Documents produced so far (reference these, don't regenerate from scratch)

| File | What it is |
|---|---|
| `01-platform-design-and-sop.md` (v0.2) | The full platform design: org model, identity model, employment/auth strategy, RBAC, schema partitioning, RLS approach, single-app architecture SOP, cross-module event pattern, module onboarding SOP, conventions, governance |
| `04-claude-code-refactor-instructions.md` | File-by-file work order for Claude Code to execute the `profiles` → `persons`/`user_accounts`/`user_roles` refactor against the actual existing codebase |
| `0007_org_hierarchy.sql` | **Already applied to the live database.** Adds `companies` table, extends `org_units` with `company_id`/`site_type`. Matches what's actually live — do not edit further; corrections go in a new migration (see below). |
| `0008_org_hierarchy_fix_and_identity_split.sql` | **Not yet applied.** Combined migration written against the confirmed live schema: (A) replaces the now-superseded `org_units.company_id` with a many-to-many `org_unit_companies` join table, (B) the core identity-split — creates `persons`/`user_accounts`/`user_roles`, backfills from `profiles`, repoints every existing FK, rewires `is_admin()`/`is_hr_or_admin()`/`update_own_biodata()`/`cast_poll_vote()`. `drop table profiles;` is left commented out. Not idempotent — see its header comment before running. |
| `05-setup-runbook.md` | Step-by-step: repo directory reorg (routes are currently misaligned with module ownership — e.g. `fair-price-shop` sits under `mess/`), `CODEOWNERS`, branch protection, Supabase project setup + migration order, Auth provider config, Vercel project + env var setup, admin bootstrap |
| `CODEOWNERS` | Ready-to-use file mapping shared files and module folders to review ownership (needs real usernames filled in) |

---

## 6. Open decisions — not yet resolved, don't assume an answer

- **`app/(protected)/services/quarter-quest/`** — unclear what this feature is or which module owns it. Needs to be asked, not guessed.
- **`app/(protected)/requests/`** — possibly a legitimate cross-module "employee requests" inbox (base-app surface, not module-owned), possibly should belong to one module. Needs an explicit decision, documented in the module registry.
- **Anonymous feedback mechanism** (HR module) — hashed/pseudonymous token vs. edge-function-stripped submission. Must be decided before that module is built; retrofitting anonymity guarantees after data exists isn't credible.
- **Offboarding system of record** — confirm with BAs whether HR or IT actually owns writing `core.employees.status` (only one module should trigger the lifecycle event).

---

## 7. What's next

- Run the setup runbook (`05-setup-runbook.md`) to actually stand up the repo/Supabase/Vercel projects, then run migrations `0001`–`0008` in order and work through the manual test checklist in `04-claude-code-refactor-instructions.md` Section 7 — the base-auth refactor itself is done (see Section 4 above), but untested against a real database.
- Once verified in staging, uncomment `drop table profiles;` at the end of `0008_org_hierarchy_fix_and_identity_split.sql` and run it as its own migration.
- Mess Management System documentation (next module to be scoped/documented after FPS).
- To-Be design phase for the FPS module (an AS-IS BRD for FPS, scoped to the Dairy Plant site, already exists as a separate baseline document).
- Remaining modules (HSE, HR, IT, AI) still need onboarding per Section 11 of the SOP once the base is live.

---

## 8. Working style / how to engage with this project

- Iterative: produce a baseline artifact, then request targeted revisions (scope changes, specific edits) rather than full rewrites.
- Cost efficiency is an explicit constraint — it's why the single-Vercel-deployment decision was made over per-module deployments.
- Decisions that need team/BA input should be flagged explicitly in deliverables, never silently assumed.
- Formal documents (SOPs, BRDs, runbooks, migrations) are primary deliverables meant for team handoff and stakeholder review, not just chat answers.
