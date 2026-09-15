# Fauji Food Verticals — Employee Portal
## Base Platform Design & Module Integration SOP
**Version 0.2 — revised for single-app / single-deployment architecture**

> **Change from v0.1:** the original draft proposed a separate Vercel project per module, unified by a portal shell. That's been replaced with a **single Next.js app, single Vercel project** for cost and operational simplicity (Section 2). This also matches how the existing base-auth codebase is already structured — module routes as folders inside one app, not separate apps. Everything about the database (Sections 3–8, 10–14) is unchanged; only Sections 2, 9, 11 and 15 are revised.

---

## 1. Purpose & Scope

This document defines the **shared foundation** that every module team (Fair Price Shop, Mess Management, HSE, HR & Feedback, IT/Service/Inventory, and the central AI Agent) must build on top of. It covers:

- The organizational and identity data model
- How different employment types authenticate
- Roles & permissions design
- How the single Supabase database is partitioned (shared core + per-module schemas)
- How multiple teams contribute their module's screens into one shared Next.js app/deployment
- The SOP a module team follows to plug into this system

Everything downstream (module-specific tables, UI, business logic) is each team's own responsibility — but it **must** be built against the identity/roles primitives defined here, and each team must follow the onboarding SOP in Section 11 before shipping.

---

## 2. High-Level Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │         ONE Next.js App (App Router)             │
                    │         ONE Vercel project, ONE deployment       │
                    │                                                    │
                    │  app/(protected)/                                  │
                    │    fps/          ← FPS team's routes               │
                    │    mess/         ← Mess team's routes              │
                    │    hse/          ← HSE team's routes               │
                    │    hr/           ← HR team's routes                │
                    │    it/           ← IT team's routes                │
                    │    ai/           ← AI Agent team's routes          │
                    │    admin/, profile/, company-updates/  ← base app  │
                    │                                                    │
                    │  lib/, components/   ← shared code, all teams read │
                    │  proxy.ts            ← one route-permission gate   │
                    └───────────────────────┬───────────────────────────┘
                                             │ one origin, one auth session —
                                             │ no cross-domain cookie setup needed
                                             │
                                  ┌──────────▼───────────┐
                                  │   Supabase Project    │
                                  │  (one Postgres DB)    │
                                  │                        │
                                  │  schema: core          │  ← this doc
                                  │  schema: fps           │  ← FPS team owns
                                  │  schema: mess          │  ← Mess team owns
                                  │  schema: hse           │  ← HSE team owns
                                  │  schema: hr            │  ← HR team owns
                                  │  schema: it            │  ← IT team owns
                                  │  schema: ai            │  ← AI team owns
                                  │  Auth (Supabase Auth)  │
                                  │  Storage, Edge Fns     │
                                  └────────────────────────┘
```

Key decisions:
- **One Supabase project, one Postgres database, many schemas.** Not one database per module — that would break the "shared employee table" requirement and make cross-module RLS impossible. Unchanged from v0.1.
- **One Supabase Auth instance.** Every login (of every type) is an `auth.users` row. The `core` schema maps that to a person and their org context. Unchanged.
- **One Next.js app, one Vercel project, one deployment — revised from v0.1.** Every module is a **route group/folder** inside the same app (`app/(protected)/<module>/...`), not a separately deployed app. This is cheaper (one Vercel project's usage/bandwidth instead of six, no per-project overhead) and simpler: there's exactly one auth session, one origin, one `proxy.ts` gate, no cross-subdomain cookie configuration, no path-rewrite/reverse-proxy layer to maintain. It also matches how the base-auth codebase you already have is structured.
- **The trade-off you're accepting**: teams now share one codebase, one build, and one deploy pipeline instead of shipping independently. Section 9 below is the SOP for managing that safely — folder ownership boundaries, what requires core-team review, and how Vercel's automatic per-branch preview deployments give each team an isolated place to verify their changes before merging, without needing a separate project.

---

## 3. Organizational Model

Fauji Food is not a single flat company — it's a group of sub-companies/brands, each with multiple physical sites, plus a head office. This has to be a first-class part of the data model, not an afterthought, because **almost every permission and every module's data is scoped by site/company**, not just by individual employee.

Core org tables:

| Table | Purpose |
|---|---|
| `core.companies` | Sub-companies / brands under the Fauji Food umbrella |
| `core.plant_sites` | Physical locations — plants, warehouses, shops, head office |
| `core.departments` | Functional departments (can be company-specific or shared, e.g. central HR) |
| `core.designations` | Job titles / grades, org-wide reference list |
| `core.org_unit_companies` | Many-to-many between `plant_sites`/`departments` and `companies` — see below |

A site or department is **not** owned by exactly one company. A physical site (a shared plant, warehouse, or head-office building) can serve more than one sub-company at once, and a department can be company-specific or fully shared (e.g. central HR at Head Office serving every brand) — so this is a many-to-many join table (`org_unit_companies`), not a single `company_id` column on the site/department row. Concretely: a site/department with zero rows in `org_unit_companies` is org-wide/shared rather than "unassigned to a company."

Every module table that holds transactional data (a mess meal record, an FPS sale, an HSE incident, an IT ticket) should carry a `site_id` **and its own explicit `company_id`** so RLS and reporting can scope by location — don't derive `company_id` from `site_id` at query time, since a shared site can resolve to more than one company. This is the single most important convention to enforce early — retrofitting site-scoping later is painful.

---

## 4. Identity Model — Persons vs Employees vs Accounts

This is the part that solves your 3-tier employment problem cleanly. We deliberately **separate three concepts** that most systems collapse into one "user" table:

### 4.1 `core.persons` — anyone the organization has a relationship with
This is the universal identity. A person may or may not ever log in. A person may or may not be paid by Fauji Food. Examples: a permanent employee, a contractual employee, a 3rd-party vendor's driver who enters a plant site and needs to be recorded in an HSE incident, a mess vendor's cook.

### 4.2 `core.employees` — extends a person with employment/HR facts
Only persons who are actually engaged (permanent or contractual, on or off payroll) get an `employees` row: employee code, company, department, designation, employment type, contract validity dates, reporting manager, status (active/suspended/offboarded).

### 4.3 `core.user_accounts` — extends a person with login capability
Only persons who need to **log into the portal** get this row, linking `core.persons.id` to Supabase's `auth.users.id`. A person can exist with zero, one login method active at a time.

**Why split it this way:** a 3rd-party contractor with no email still needs to exist as a `person` (so HSE can log a safety incident involving them, or Mess can record a meal issued to them) without ever needing an `employees` or `user_accounts` row. A permanent employee has all three. This avoids forcing every module to special-case "what if this person has no email/no login."

---

## 5. Employment Types & Authentication Strategy

| Employment type | Gets official email? | Login method | Notes |
|---|---|---|---|
| **Permanent staff** | Yes (M365 tenant email) | **Azure AD / Microsoft 365 SSO** via Supabase Auth OAuth provider, restricted to your tenant | Primary, most-trusted identity path |
| **Contractual — with official email** | Sometimes | Same M365 SSO if they have a mailbox; otherwise falls to the row below | Flag `has_official_email` on `employees`, don't assume by employment type alone |
| **Contractual — no official email** | No | **Admin-provisioned account**: employee code + temp password (forced reset on first login), or phone number + OTP | Account created by HR/IT admin, not self-registration |
| **3rd-party vendor staff (not on payroll)** | No | **Default: no login at all** — they exist only as `core.persons` records referenced by other modules (HSE incident logs, mess meal issuance, gate/visitor records). **If** a module genuinely needs them to interact with the system (e.g. submit an HSE report themselves, or a vendor portal for IT tickets), issue a **scoped external account**: phone OTP or email/password, admin-approved, `is_external = true`, tied to a sponsoring company + site, with a mandatory `access_expires_at` matching contract end date | Never give 3rd-party accounts org-wide roles; always scope to one site/module |

Practical rules to bake in from day one:
- **Never hardcode "employment type X = login method Y" in module code.** Read it off `core.employees.has_official_email` and `core.user_accounts.auth_method`. HR reality is messier than the 3 buckets and will keep having exceptions.
- **External accounts (`is_external = true`) must be time-bound.** A scheduled job (or trigger on `contract_end_date`) should flip `user_accounts.status` to `suspended` automatically — don't rely on someone remembering to deactivate a vendor login.
- Supabase Auth supports Azure/OAuth, email/password, and phone/OTP simultaneously in one project — no need for a separate auth system per employment type.

---

## 6. Roles & Permissions (RBAC)

Two axes matter: **what you can do** (permission) and **where you can do it** (scope: global / company / site). A flat "role = permission set" model breaks the moment you need "Plant Manager at Site A" to differ from "Plant Manager at Site B."

Design:

- `core.permissions` — fine-grained, module-namespaced permission codes, e.g. `fps.manage_inventory`, `hse.report_incident`, `hse.close_incident`, `hr.view_feedback_anonymized`, `it.assign_asset`, `ai.query_cross_module`.
- `core.roles` — named bundles of permissions, e.g. `plant_manager`, `hse_officer`, `hr_admin`, `fps_cashier`, `super_admin`.
- `core.role_permissions` — many-to-many.
- `core.user_roles` — assigns a role to a person **with an optional scope** (`company_id`, `site_id` — both nullable, meaning "global" if null). This is what lets "HSE Officer" mean something different at each plant without creating a role per site.

A helper SQL function `core.has_permission(permission_code, site_id)` (included in the SQL file) is what every module's RLS policies and API layer should call — module teams should never write their own ad-hoc permission logic against raw tables.

**Two layers, one mechanism, not two systems.** Not every check carries the same weight, so `core.permissions` codes follow two naming conventions instead of two auth systems:

- **Module access (coarse):** `module:<code>` (e.g. `module:hse`, `module:fps`) — a single yes/no gate answering "can this person open this module at all." Checked once, at the module's route-group boundary, by the shared route-permission map (a Section 9.1 shared file).
- **In-module features (fine-grained):** `<module>.<verb>_<object>` (e.g. `hse.report_incident`, `hse.close_incident`) — as many or as few as a module needs, shaped however that team's own screens and workflows require.

Both are just rows in the same `permissions` / `role_permissions` / `user_roles` tables, checked through the same `has_permission()` function and the same company/site scoping — the split is a naming convention, not separate schema. That's what keeps one Admin UI, one audit log, and one thing for the AI Agent module to query, while still letting each team define their own feature-level roles and permissions without coordinating with the other five.

A module's own `<module>.*` feature codes, and the roles that bundle them, are that team's to create and change freely — insert/update rows in `permissions` / `roles` / `role_permissions` as features evolve, **no core-team review required**, since it's data scoped to that module's own codes and can't affect another module's rows. The one `module:<code>` coarse-access code per module is registered once during onboarding (Section 11) and **does** need core-team sign-off, since it's what the shared route-permission map keys off. This is what keeps roles consistent portal-wide (e.g. so "Site Manager" automatically gets sensible module-level access across FPS, Mess and HSE) without forcing six teams through one review queue for every feature-level permission change.

---

## 7. Database Schema Strategy

One Postgres database, partitioned by **Postgres schema**, not by table prefix:

```
core   — this document. Owned by platform/core team. Every module reads from it; only the core team migrates it.
fps    — Fair Price Shop Management. Owned by FPS team.
mess   — Mess Management. Owned by Mess team.
hse    — Health, Safety & Environment. Owned by HSE team.
hr     — HR docs + anonymous feedback. Owned by HR team.
it     — Onboarding/offboarding, service desk, inventory. Owned by IT team.
ai     — Central AI agent's own logs/config (read access to everything else via views). Owned by AI team.
```

Rules every module schema must follow:

1. **Never duplicate identity data.** No module creates its own `users` or `employees` table. Reference `core.persons(id)` or `core.employees(id)` by foreign key.
2. **Never reference `auth.users` directly** from module tables — always go through `core.persons`. `auth.users` is a Supabase-managed implementation detail; `core.persons` is the stable business identity, and a person can exist before/without ever having an auth account.
3. **Standard audit columns** on every table: `created_at timestamptz default now()`, `updated_at timestamptz`, `created_by uuid references core.persons(id)`, `updated_by uuid references core.persons(id)`. Prefer soft delete (`deleted_at timestamptz`) over hard delete for anything with compliance/audit relevance (HSE incidents, HR feedback, inventory movements).
4. **UUID primary keys everywhere** (`uuid` type, `gen_random_uuid()` default) — never serial/int — so IDs are safe to reference across schemas and never collide.
5. **Site/company scoping column** (`site_id`, `company_id` where relevant) on transactional tables, as noted in Section 3.
6. Module teams have full freedom over their own schema's internal design beyond these rules.

---

## 8. Row-Level Security (RLS) Approach

- RLS is **on** for every table in every schema, no exceptions — this is a multi-tenant-ish system (multiple companies/sites/employment tiers sharing one DB) and RLS is the enforcement layer, not just the API layer.
- Standard policy pattern for a module table with a `site_id` column:

```sql
create policy "site_scoped_read" on fps.sales
for select using (
  core.has_permission('fps.view_sales', site_id)
);
```

- `core.has_permission()` internally checks: does the current `auth.uid()` map to a person with a role (global, or scoped to this row's site/company) that grants this permission. This means module teams write one line of policy, not custom logic per table.
- The **AI Agent module is the one exception to "module owns its schema in isolation"** — by design it needs read access across modules to answer employee questions. It should be given access only via **security-definer views in `core`** (e.g. `core.v_employee_summary`) that already bake in row-level scoping, never raw cross-schema table grants. See Section 14.

---

## 9. Single-App Architecture: Working in One Shared Codebase

One Vercel project means one Next.js app that every team commits to. That's cheaper and simpler to run, but it only stays manageable if the codebase has clear ownership boundaries and a git workflow that stops one team's in-progress work from blocking another's release. This section is that SOP.

### 9.1 Folder ownership

- Each module team owns exactly one top-level folder: `app/(protected)/<module>/**` (`fps/`, `mess/`, `hse/`, `hr/`, `it/`, `ai/`). A team can add, edit, and restructure anything inside its own folder without needing another team's review.
- **Shared files require core/platform-team review regardless of who authors the change**, because a mistake here breaks every module at once: `proxy.ts`, `lib/auth/**`, `lib/auth/route-permissions.ts`, `app/(protected)/sidebar.tsx` / `topbar.tsx`, `lib/supabase/**`, `types/database.ts`, and anything under `core`'s Supabase schema/migrations.
- Shared UI primitives (`components/**`) are additive by convention: a team can add a new shared component, but changing or removing one that other modules already use needs a heads-up to whoever owns those call sites — enforce via code review, not tooling, at this team size.
- Add a `CODEOWNERS` file at the repo root encoding the above so GitHub/GitLab auto-requests the right reviewers instead of relying on people remembering the convention.

### 9.2 Git workflow

- `main` is what's deployed to production (Vercel's Production environment, auto-deployed on merge to `main`).
- Every change — including a module team's own routes — goes through a feature branch and a pull request, never a direct push to `main`. This is what makes the "one shared deploy pipeline" trade-off safe: Vercel automatically builds a **preview deployment for every PR/branch**, giving each team an isolated URL to check their work against staging data before it ever touches `main` — this is the single-project equivalent of the isolation a separate Vercel project would have given you, at no extra cost.
- Recommend a lightweight `staging` branch sitting between feature branches and `main` if you want a shared pre-production environment multiple teams can test against together (useful once modules start depending on each other's data via the integration events in Section 10) — optional for Phase 1, add it when the first cross-module dependency shows up.
- CI (GitHub Actions or Vercel's own build step) must run typecheck + lint + build on every PR before merge is allowed. Because it's one app, one team's broken code can fail the shared build — this is the actual cost of the single-deployment choice, and a required, fast CI gate is what keeps it from becoming everyone else's problem.

### 9.3 Shared auth & types

- `lib/auth/**` (the `requireAdmin()` / `requireHrOrAdmin()` / `requireActiveUser()` pattern, `current_person_id()` usage, route-permission gating) is written once and imported by every module — no team reimplements login/session/permission logic in their own folder.
- `types/database.ts` is generated from the live schema (`npx supabase gen types typescript --project-id <ref> > types/database.ts`) and committed — regenerate it as part of any PR that changes schema, whether that's a `core` migration or a module's own schema.

### 9.4 What you gave up, and how this SOP covers it

| What separate deployments would have given you | How the single-app SOP covers the same need |
|---|---|
| Independent release timing per team | Feature branches + PR review; a team merges to `main` when *their* code is ready, independent of other in-flight branches, as long as `main` itself stays green |
| Isolated environment to test in before going live | Vercel's automatic per-PR preview deployment |
| A broken module doesn't take down others | Required CI (typecheck/lint/build) gate on every PR merging to `main` |
| Clear code ownership | `CODEOWNERS` + the folder convention in 9.1 |

What you don't get back, and should just accept as the cost of this choice: if `main`'s build genuinely breaks, every module is down until it's fixed — there's no per-module blast-radius containment at the infrastructure level anymore. The CI gate is what keeps that rare rather than routine.

---

## 10. Cross-Module Integration Pattern (Events)

Modules will need to react to things that happen in other modules without being tightly coupled to them — the classic case being **offboarding**: when IT marks an employee offboarded, Mess should stop issuing meals, FPS should disable their account, HSE should close out any assigned safety equipment, etc.

Pattern: a simple **event outbox table** in `core`, not direct cross-schema writes between modules.

```
core.integration_events
  id, event_type, person_id, company_id, site_id, payload jsonb, created_at, processed boolean
```

- Any status change on `core.employees` (e.g. `status` → `offboarded`) fires a trigger that inserts a row here.
- With a single-app deployment, consuming these events doesn't need a separate Edge Function per module: add **one shared Vercel Cron Job** (a single scheduled route, e.g. `app/api/cron/process-integration-events/route.ts`) that reads unprocessed `core.integration_events` rows and, for each event type, calls a small handler function living inside the owning module's own folder (`app/(protected)/mess/lib/onEmployeeOffboarded.ts`, etc.). One cron config instead of six.
- Modules **never write directly into another module's schema**, even though the code now lives in the same repo. If FPS needs to know an employee was offboarded, its handler reacts to the event and updates its own `fps` tables — it doesn't reach into `hr` or `it`'s tables directly. This is a discipline/code-review rule now, not an infrastructure boundary, since everything runs in one app — enforce it via the folder-ownership review in Section 9.1.
- This still gives you portal-wide consistency on lifecycle events without tightly coupling modules' internal logic to each other.

---

## 11. Module Onboarding SOP

Every module team (including future ones beyond the current six) follows this before writing module code:

1. **Register the module** — add a row to `core.modules` (code, name, owning team, schema name, status = `planned`).
2. **Request/create the Postgres schema** — core team runs `create schema <module>;` and grants the module team's Supabase role usage on it.
3. **Design your ERD referencing `core.persons` / `core.employees`** — no shadow identity tables. Submit ERD to this Project as your planning doc before building.
4. **Register your module's coarse access code** — `module:<code>` — with the core team; this is what gates the module's route-group boundary in the shared route-permission map (core-reviewed, Section 9.1). **Then own your fine-grained codes** — insert whatever `<module>.<action>` permissions and roles your features need directly into `core.permissions` / `core.roles` / `core.role_permissions`; no core-team review required for these, they're your data to shape as your module evolves (Section 6).
5. **Declare integration events** — list what `core.integration_events` types you emit (e.g. `hse.incident_reported`) and what types you consume (e.g. `it.employee_offboarded`).
6. **Write RLS policies** using `core.has_permission()` for every table — no table ships without RLS enabled.
7. **Apply audit column + UUID + site-scoping conventions** (Section 7) — reviewed by core team before merge.
8. **Create your module's folder** — `app/(protected)/<module>/` in the shared repo (Section 9.1) — and add your entry to `sidebar.tsx`/`topbar.tsx` nav config via a reviewed PR (these are shared files; a core-team reviewer approves the nav change alongside your first feature PR). No separate Vercel project or deployment to provision — you're shipping into the existing app.
9. **Document the module** in this Project: ERD, permission list, RLS policy summary, events emitted/consumed, and any module-specific auth exceptions (e.g. a public-facing external form). This becomes the reference other teams check before they touch anything you own.
10. **Staging sign-off** — core team validates RLS policies (can a Site A HSE officer see Site B data? can a 3rd-party account escalate scope?) before production release, and confirms your PR's Vercel preview deployment behaves correctly before merge to `main`.

---

## 12. Schema & Coding Conventions (Quick Reference)

- Schema names: lowercase, short, matches module code (`fps`, `mess`, `hse`, `hr`, `it`, `ai`).
- Table names: `snake_case`, plural (`incidents`, not `incident`).
- Every FK to a person: `person_id uuid references core.persons(id)`. Every FK to an employee-specific fact: `employee_id uuid references core.employees(id)`.
- Every table: `id uuid primary key default gen_random_uuid()`.
- Every table: RLS enabled, audit columns present, soft-delete where compliance-relevant.
- Permission codes: `<module>.<verb>_<object>`, all lowercase, e.g. `mess.approve_menu_change`.
- Migrations: managed via Supabase CLI migration files, one PR per migration, core-schema migrations require core team review regardless of which team authored them.

---

## 13. Environments & Governance

- ~~One Supabase project per environment (dev / staging / prod), not one project shared across environments — gives you real isolation for testing destructive migrations.~~ **Overridden 2026-09-16: single shared Supabase project across all environments**, by explicit choice. The isolation this gives up is real — a destructive migration or a bad test write has no dev/staging buffer before it touches the same data everything else uses — so treat every migration against it with prod-level care (back up/snapshot before anything with a `drop`/`alter ... drop column` in it), and there's no free "break it in dev" environment for module teams to experiment in anymore. If cost or setup friction was the driver, revisit this once real users are on the system — the risk profile changes a lot the moment there's real data to lose.
- `core` schema changes are **gated**: any team can propose a migration, but only the core/platform team merges changes to `core.*` — this is your single point of control preventing six teams from drifting the shared identity model in six directions.
- Module schema changes are owned and merged by the respective module team, but must pass an automated check (recommend a simple CI lint) verifying: RLS enabled on new tables, standard audit columns present, no direct FK to `auth.users`.
- Maintain a lightweight **module registry doc** (mirrors `core.modules` table) in this Project so BAs can see at a glance what's live, what's planned, and who owns what.

---

## 14. Special Notes Per Module

- **Fair Price Shop / Mess Management**: both are transactional + inventory heavy and both need to answer "is this person entitled to this benefit right now" — that's an `core.employees.status = active` + role/scope check, don't build a parallel entitlement table; derive entitlement from core wherever possible.
- **HSE**: will be the heaviest user of `core.persons` records for people who are *not* employees (3rd-party workers on site during an incident). Make sure your incident tables reference `person_id`, not `employee_id`, so non-employees can be named in a report.
- **HR docs + Anonymous Feedback**: anonymity is a real design constraint, not just a UI toggle — the feedback table should **not** store `person_id` in a form that's queryable back to identity by normal roles (e.g. store only a one-way hashed/pseudonymous token, or route submission through an edge function that strips identity before insert). Decide this explicitly before building; retrofitting anonymity guarantees after the fact is not credible.
- **IT Onboarding/Offboarding + Service + Inventory**: this module is the natural **owner/trigger** of employee lifecycle events (Section 10) since onboarding/offboarding are IT-initiated in most orgs — confirm with your BAs whether HR or IT is the actual system of record for the offboarding trigger, and make sure only one module owns writing `core.employees.status`.
- **Central AI Agent**: gets read access only via `core` security-definer views (Section 8), never direct table grants across module schemas. Every query it runs on behalf of a user should still be subject to that user's own RLS-derived scope — the agent should not become a way to bypass per-site/per-role restrictions "because it's an AI." Log every cross-module query it makes for auditability.

---

## 15. Phase 1 — What to Build First

Before any module team starts:

1. Provision Supabase project(s) (dev/staging/prod) and **one** Vercel project connected to the app repo (Production = `main`, Preview = every other branch/PR, automatically).
2. Run the `core` schema migration.
3. Stand up Azure AD SSO for permanent/official-email staff.
4. Stand up admin-provisioning flow (employee code + temp password, or phone OTP) for no-email contractual staff.
5. Seed `core.companies`, `core.plant_sites`, `core.departments`, `core.designations` with real org data.
6. Define initial `core.roles` / `core.permissions` for a first small set (e.g. `super_admin`, `plant_manager`, `employee`) — more get added as each module registers its own.
7. Add the `CODEOWNERS` file and branch protection on `main` (required PR review + required CI checks) described in Section 9 — do this before the first module team's PR lands, not after.
8. Build the base app's login screen + role-aware navigation (this already exists in the current codebase) so subsequent teams have something to plug their folder into.
9. Only then: kick off Section 11's onboarding SOP with the first module team (recommend starting with whichever of the six has the simplest data model, to validate the pattern before the harder ones like HSE/AI).
