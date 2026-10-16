# IT Module (M2) — Inventory & Asset Management
## Implementation & Development Plan (Talha's track)

Written against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11), the HR module
precedent (`06-hr-module-design.md`, migrations `0012`–`0020`), the IT BRD
(`final_doc_updated.docx`), and ERD v4 (`ERD_Employee_Portal_v4_detailed (1).pdf`, 25 tables).

| | |
|---|---|
| Module code / schema | `it` / `it` |
| Coarse access | `module:it` (registered by the senior dev, shared by both IT tracks) |
| This track | **Inventory**: asset register, assignments, maintenance, stock movements, valuation |
| Other track | **Service Management, Procurement & On/Offboarding** (Javeria, `it/javaria`) |
| Branch flow | `it/talha` + `it/javaria` → `it/dev` (IT testing) → `develop` (senior dev) |
| Migrations | Staged in `supabase/it-migrations/talha/` (see that folder's README) |

**Decision log**
- 2026-10-12: Procurement (ERD section D) and Onboarding/Offboarding (section E) are owned by
  Javeria.
- 2026-10-12: All ERD additions in §1.3 are accepted.
- 2026-10-13: Both tracks' staged migrations were reconciled into the main sequence as
  `0024`–`0029` (see `supabase/it-migrations/README.md`). New staged files keep their per-author
  numbering (`talha_it_0004`, …); they get main-sequence numbers (`0030`+) at merge time.

---

## 0. Status — 2026-10-16

Gap check of ERD v4 (25 tables) against `supabase/migrations/0001`–`0029` plus the staged files
applied to the live DB since (`talha_it_0004`–`0008`, see `supabase/it-migrations/README.md`).

### 0.1 ERD tables already covered (14)

| ERD section | ERD tables | Where |
|---|---|---|
| A — Org & Access | `roles`, `users`, `employees`, `departments`, `locations` | Core tables per §1.1 (`roles`, `user_accounts`, `persons`, `org_units`, `companies`) |
| B — Ticketing | `tickets`, `ticket_tasks`, `request_types` | `0025_it_tickets.sql` (+ `ticket_categories`, `sla_policies`, `ticket_updates`, `ticket_attachments`, not in the ERD) |
| C — Inventory | `asset_types`, `asset_value_types`, `assets` | Baseline + `0026_it_inventory_settings.sql`, `0028_it_assets.sql` |
| E — On/Offboarding | `onboarding_offboarding`, `checklist_items` | `0027_it_onboarding_offboarding.sql` (+ `onboarding_updates`) |
| F — Audit | `audit_log` | `public.audit_log` (`0004`) |

Also live and outside the ERD: `it.number_sequences` (`0024`), `it.notifications` (`0029`).

Live since, staged only (no main-sequence number yet): `asset_assignments` (`talha_it_0004`),
`asset_maintenance` (`talha_it_0005`; screens are Phase 4), `asset_values` (`talha_it_0006`;
screens are Phase 6).

### 0.2 ERD tables still missing (8)

| Table | Owner | Blocked by | Phase |
|---|---|---|---|
| `stock_movements` | **Talha** | `it.products` | 5 |
| `vendors`, `products`, `demands`, `demand_approvals`, `receiving_records`, `invoices`, `payments` (+ `documents`, §1.3 #3) | Javeria | — | Her procurement track |

### 0.3 Placeholder FKs (plain `uuid` columns, constraint not added yet)

| Column | Target | Can be added when |
|---|---|---|
| `assets.vendor_id`, `assets.receiving_id` | `it.vendors`, `it.receiving_records` | Javeria's procurement migrations, then Phase 7 |
| `asset_maintenance.vendor_id` | `it.vendors` | Same |
| `stock_movements.product_id` | `it.products` | Javeria ships `products` |

Added in `talha_it_0004` (live 2026-10-14): `tickets.linked_asset_id → it.assets` and
`checklist_items.assignment_id → it.asset_assignments`.

### 0.4 Screen status

| Screen | State |
|---|---|
| INV-01 `/it/inventory/settings` | Built (asset types CRUD + value types) |
| SCR-05 `/it/inventory` | Built (list) |
| INV-02 `/it/inventory/new`, `/[id]/edit` | Built (create + edit) |
| INV-03 `/it/inventory/[id]` | Built: Overview, Assignment history (+ Assign / Return), Maintenance (+ Send for repair / Close repair), Linked tickets, Change status, soft Delete. Still waiting: Movements (Phase 5), Valuation (Phase 6), and the vendor link / Origin section (Phase 7) |
| INV-04 assign / return | Built: panels on INV-03, also exported as `<AssetAssignForm>` / `<AssetReturnForm>` for Javeria's on/offboarding pages |
| INV-05 `/it/my-assets` | Built (open assignments, Model column, Acknowledge) |
| INV-06 `/it/inventory/maintenance` | Built: Repair Log across all assets (filters: status, asset tag, sent-date range; max 500 rows). Read-only — repairs start and close on INV-03 |
| INV-07 – INV-08, `<InventoryKpis>` | Not built |

---

## 1. Translating the ERD into portal conventions

ERD v4 models the IT system as if it were standalone: INT keys, and its own users, roles,
employees, locations, departments and audit tables. The SOP doesn't allow that (§7 rules 1–4), so
each ERD concept is mapped onto what already exists. **This section applies to both IT tracks.**

### 1.1 ERD tables that must NOT be created in `it`

| ERD table | Use instead | Notes |
|---|---|---|
| `users` | `public.user_accounts` + `public.persons` | Every `*_user_id` FK becomes `*_person_id → public.persons(id)` |
| `roles` | `public.roles` / `permissions` / `role_permissions` | IT access is permission keys, not an IT role table |
| `employees` | `public.persons` | `employee_code`, `designation`, `company_id`, `site_id`, `date_of_joining`, `status` already exist |
| `departments` | `public.org_units` where `type = 'Department'` | |
| `locations` | `public.org_units` where `type = 'Site'` (+ `site_type`) | |
| `audit_log` | `public.audit_log` via `lib/audit/log.ts` (`module = 'it'`) | |

### 1.2 Column-level conventions applied to every `it.*` table

| ERD | Portal |
|---|---|
| `INT` PK | `id uuid primary key default gen_random_uuid()` |
| `created_by_user_id`, `performed_by_user_id`, … | `created_by` / `performed_by_person_id uuid references public.persons(id)` |
| `created_at` only | `created_at`, `updated_at` (+ `public.set_updated_at()` trigger), `created_by`, `updated_by` |
| `assets.owning_company VARCHAR(10)` | `company_id uuid references public.companies(id)` |
| `assets.current_location_id` | `site_id uuid references public.org_units(id)` |
| Free-text status columns | `text` + `check (... in (...))`, same style as `hr.tickets.status` |
| Hard delete | `deleted_at timestamptz` on assets, movements and procurement rows (compliance-relevant) |
| Transactional rows | carry both `company_id` and `site_id` (SOP §3; never derived from site) |

### 1.3 Accepted ERD additions (2026-10-12)

| # | Addition | Table owner |
|---|---|---|
| 1 | `demands.vendor_id` (nullable, set at the vendor-assignment step) | Javeria |
| 2 | `invoices.approved_by`, `approved_at`, `approval_comments` | Javeria |
| 3 | Generic `it.documents` table (`entity_type`, `entity_id`, `doc_type`, `storage_path`) + private `it-documents` Storage bucket, for Delivery Challan / Gate Pass / invoice files. Designed generically so the inventory track can attach files to assets later | Javeria |
| 4 | `stock_movements.site_id` + `company_id`, so consumable stock is counted per site | **Talha** |
| 5 | `products.asset_type_id` (nullable FK → `it.asset_types`), so receiving a fixed-asset product can create an asset record | Javeria (FK points at Talha's table) |
| 6 | Asset status vocabulary: `Unassigned`, `In Use`, `In Repair`, `Retired`, `Disposed`, `Lost` | **Talha** |
| 7 | Partial unique index on `asset_assignments (asset_id) where return_date is null`: at most one current holder per asset | **Talha** |

---

## 2. Ownership split with Javeria

| ERD section | Tables | Owner |
|---|---|---|
| A — Org & Access | (core tables, §1.1) | Senior dev (no IT work) |
| B — Ticketing | `tickets`, `ticket_tasks`, `request_types` | Javeria |
| C — Asset & Inventory | `assets`, `asset_types`, `asset_assignments`, `asset_values`, `asset_value_types`, `asset_maintenance`, `stock_movements` | **Talha** |
| D — Procurement | `products`, `vendors`, `demands`, `demand_approvals`, `receiving_records`, `invoices`, `payments` (+ `documents`) | Javeria |
| E — Onboarding/Offboarding | `onboarding_offboarding`, `checklist_items` | Javeria |
| F — Audit | `public.audit_log` | Shared helper, already exists |

### 2.1 Contracts between the two tracks

With procurement on Javeria's side, the dependency runs **both ways**. Agree on each contract
before either of us writes the matching migration.

**Talha's tables that reference Javeria's**

| FK | Used for | Ordering rule |
|---|---|---|
| `assets.vendor_id → it.vendors` | Supplier of the asset | Column created in Talha's Phase 2 **without** the FK; the constraint is added in `talha_it_00xx_link_procurement_fks.sql` once her vendors migration is applied |
| `assets.receiving_id → it.receiving_records` | Trace an asset to its goods receipt | Same: column first, FK in the linking migration |
| `asset_maintenance.vendor_id → it.vendors` | Repair vendor | Same linking migration (or after vendors exists, if hers lands first) |
| `stock_movements.product_id → it.products` | Consumable stock | Phase 5 needs `it.products` applied first. **Ask Javeria to ship vendors + products early** |

**Javeria's tables that reference Talha's**

| FK | Used for | Ordering rule |
|---|---|---|
| `tickets.linked_asset_id → it.assets` | Ticket about a specific device | `it.assets` (Talha Phase 2) applied first, or she adds the FK later |
| `checklist_items.assignment_id → it.asset_assignments` | Onboarding equipment issue / offboarding return | Talha Phase 3 applied first |
| `products.asset_type_id → it.asset_types` | Addition #5 | Talha Phase 1 applied first |

**Functions and components Talha provides for Javeria's flows**

| Provided by Talha | Called from Javeria's flow |
|---|---|
| `assignAsset()` / `returnAsset()` Server Actions + embeddable `<AssetAssignForm>` / `<AssetReturnForm>` | Onboarding "Asset Allocation" task, offboarding "Asset Return Form" |
| `registerAssetsFromReceipt(receivingId, …)`: creates draft asset rows linked to the receipt | Receiving a fixed-asset demand |
| `recordStockMovement({ productId, siteId, type, qty, reference })` | Consumable demand exception path + receiving consumables |
| `listOpenAssignments(personId)` | Offboarding: what the leaver still holds |

**Shared surfaces**

| Surface | Arrangement |
|---|---|
| Foundation migration (schema grants, `module:it`, `it.next_number()` sequence helper) | Written once by whoever starts first, staged in **that** author's folder; the other lists it under `Depends on` |
| `/it/dashboard` (SCR-06) | Javeria owns the page; Talha supplies an `<InventoryKpis>` component |
| `/it/admin/roles` | Built once (copy `hr/admin/roles`), one section per track |
| `sidebar.tsx`, `route-permissions.ts`, `home-path.ts` | Both edit, each in their own block |
| `types/database.ts` | Regenerated on `it/dev` after merges, not on feature branches |

---

## 3. Permissions (this track)

Following the per-operation style HR moved to in `0017` (`<module>.<resource>.<op>`). Every
insert must include `label`, because `0020` made `permissions.label` NOT NULL. Procurement and
service-management keys (`it.vendors.*`, `it.demands.*`, `it.tickets.*`, …) are Javeria's to
define.

| Key | Label | Gates |
|---|---|---|
| `module:it` | IT | Opening `/it/**` at all. Grant to the base Employee role (employees need My Assets) |
| `it.assets.read` | View Asset Register | `/it/inventory`, asset detail |
| `it.assets.create` | Register Assets | Add asset |
| `it.assets.update` | Edit Assets | Edit, change status |
| `it.assets.delete` | Retire/Delete Assets | Soft delete |
| `it.assets.assign` | Assign/Return Assets | Assignment + return forms (also called from on/offboarding) |
| `it.maintenance.update` | Log Repairs | R&M log |
| `it.stock.read` | View Stock | Stock levels and movements |
| `it.stock.update` | Record Stock Movements | Stock in/out |
| `it.valuation.update` | Manage Valuations | Asset values |
| `it.inventory_settings.update` | Inventory Settings | Asset types, value types |
| `it.manage_role_permissions` | IT Role Permissions | `/it/admin/roles` (shared with Javeria; whoever writes the foundation migration adds it) |

**Limitation to flag:** `has_permission(key)` has no site/company argument today, even though the
SOP (§6) describes `has_permission(code, site_id)`. A "Plant Site IT Team" that can only see its
own plant's assets can't be enforced in RLS until the senior dev adds a scoped variant. Phase 1
ships with global permissions, and `site_id` is stored on every row so scoping can be added later
without a data backfill.

---

## 4. Screen inventory (this track)

Routes live under `app/(protected)/it/`. "SCR-xx" refers to the BRD's screen list; "INV-xx" are
the additional screens the BRD's process sections imply.

| ID | Route | Who | Purpose |
|---|---|---|---|
| INV-01 | `/it/inventory/settings` | IT admin | Asset types (with Fixed/Consumable classification) and value types (New/Old, depreciation %, method, useful life) |
| SCR-05 | `/it/inventory` | IT | Asset register: search by tag/serial/holder; filter by type, status, site, company; add asset |
| INV-02 | `/it/inventory/new`, `/it/inventory/[id]/edit` | IT | Asset form (BRD §5.5.1 fields); tag auto-generated |
| INV-03 | `/it/inventory/[id]` | IT | Asset detail with tabs: Overview · Assignment history · Maintenance · Valuation · Movements · Linked tickets (read-only from Javeria's `it.tickets`) · Origin (receipt/demand, read-only from Javeria's procurement tables) |
| INV-04 | modal on INV-03 (+ embeddable) | IT | Asset Assignment Form and Asset Return Form (BRD fields) |
| INV-05 | `/it/my-assets` | Every employee | Assets currently assigned to me; acknowledge handover |
| INV-06 | `/it/inventory/maintenance` | IT | Repair Log: read-only list of repairs across all assets (filters: status, asset tag, sent-date range). Repairs are started ("send for repair") and closed on the asset page (INV-03) |
| INV-07 | `/it/inventory/stock` | IT | Consumable stock levels per site; Stock In / Stock Out form; movement history |
| INV-08 | `/it/inventory/reports` | IT mgmt | Inventory status, utilisation, warranty expiry, maintenance cost; CSV export |
| SCR-06 (part) | `/it/dashboard` | IT | Inventory KPI cards + asset-status breakdown (component inside Javeria's page) |
| — | `/it/admin/roles` | IT admin | Shared with Javeria (§2.1) |

UI follows the HR pages: server components that query with `.schema("it")`, Server Actions with
`requirePermission()` / `requireActiveUser()`, `PageHeader`, `Modal`, `StatusPill`, and
`has_permission` RPCs to hide controls the viewer can't use. Cross-schema joins to
`public.persons` can't be embedded by supabase-js, so names are fetched separately (same as
`hr/admin/categories/page.tsx`).

---

## 5. Phased delivery

Each phase is one PR from `it/talha` into `it/dev`: one or more staged migrations, the screens,
the Server Actions, and a test checklist for the tester. Phases are ordered by data dependency.

### Phase 0 — Alignment and setup (no feature code) — ✅ done
- [x] **Capture the live `it` schema baseline.** The `it` schema was created directly in Supabase
      and isn't in any migration file. It also isn't on the Exposed Schemas list, so the app (and
      a REST probe) can't see it. Dump it (`supabase db dump --schema it`, or Dashboard SQL) and
      commit it as `talha_it_0000_baseline_live_snapshot.sql`, marked "Applied: YES (pre-existing)".
      Then diff it against §1. If it contains ERD-style `users`/`roles`/`employees`/INT keys, it
      needs a rework migration before anything is built on top of it. Share the result with
      Javeria, since it affects her tables too.
- [x] Senior dev: register `module:it`, add `it` to Exposed Schemas, and create `it/dev` from the
      current base.
- [x] Agree on the foundation-migration author and the §2.1 contracts with Javeria. Ask her to
      sequence vendors + products early. *(Foundation written by Talha → `0024`.)*

### Phase 1 — Foundation and inventory settings — ✅ done (`0024`, `0026`; INV-01 built)
**Migration** `talha_it_0001_foundation.sql` (skip if Javeria writes it): schema grants mirroring
`0012` (`grant usage` + default privileges for `authenticated`), number-generator helper
(`it.next_number(prefix)` backed by sequences, also usable for her `ONB-`/`OFB-`/`DMD-`/ticket
numbers), `module:it` + `it.manage_role_permissions`.
**Migration** `talha_it_0002_inventory_settings.sql`: `asset_types`, `asset_value_types`, this
track's `it.*` permission rows (with labels), and RLS (read: `module:it`; write:
`it.inventory_settings.update`). Seeds asset types (Laptop, Desktop, Monitor, Printer, Server,
Network, Mobile, Peripheral, Software License; Fixed vs Consumable) and value types (New, Old).
**Screens**: INV-01, plus the inventory section of `/it/admin/roles`.
**Shared-file edits**: IT nav group in `sidebar.tsx`, IT entries in `route-permissions.ts`.
**Done when**: an IT admin can maintain asset types and value types, and a non-IT employee can't
reach them (proxy and RLS both).

### Phase 2 — Asset register — ✅ done (2026-10-13; `0028` live)
Built: register (rows link to detail), add, edit, INV-03 detail (Overview + Linked tickets),
manual status change (Unassigned / Retired / Disposed / Lost only — `In Use` and `In Repair` are
owned by the Phase 3/4 flows and locked on the page), and soft delete (blocked while `In Use` /
`In Repair`). Site dropdowns and names now use `it.list_org_units()`, so non-admin IT staff see
sites. Tags are typed in by hand on Add and Edit (decision #5, 2026-10-14); the
`tickets.linked_asset_id` FK moves into the Phase 3 migration.
**Migration** `talha_it_0003_assets.sql`: `it.assets`. Tag originally auto-generated
(`AST-000001`); since decision #5 it is entered manually (`talha_it_0007` drops the default); unique
`asset_tag` and `serial_number`; `company_id`, `site_id`, `status` (§1.3 #6), `condition`,
`warranty_expiry`, `deleted_at`. `vendor_id` and `receiving_id` columns exist but have no FK yet
(§2.1).
**Screens**: SCR-05, INV-02, INV-03 (Overview tab).
**Done when**: assets can be registered, searched by tag/serial, filtered and edited, and every
change writes an audit-log row.

### Phase 3 — Assignment, return and My Assets — ✅ done (2026-10-16; `talha_it_0004`, `0008` live)
Built: INV-03 Assign panel (Unassigned assets; live employee picker over `it.search_people`,
active employees only) and Return panel (holder's name; new status Unassigned or Retired —
`In Repair` is left to Phase 4's repair form so no repair is opened without a record), the
Assignment history section (names via `it.asset_person_names`, which keeps showing people who
have left), and INV-05 My Assets with Acknowledge. Names don't use Javeria's `person_names()`:
`talha_it_0008` adds the inventory-side lookups instead, leaving her function untouched.
Hand-off: `assignAsset` / `returnAsset` / `searchPeople` (Server Actions),
`<AssetAssignForm>` / `<AssetReturnForm>` (`app/(protected)/it/inventory/_components/`, each
takes an optional `returnTo` path under `/it/`), and `listOpenAssignments()` (`lib/it/assets.ts`).
`listOpenAssignments` reads through RLS, so it returns rows only to `it.assets.read` holders or
the person themself — on/offboarding staff without `it.assets.read` get an empty list.
**Migration** `talha_it_0004_asset_assignments.sql`: `it.asset_assignments` with the partial
unique index (§1.3 #7); a security-definer `it.assign_asset()` / `it.return_asset()` pair that
writes the assignment row and flips `assets.status` atomically, so the two can't drift; RLS that
lets employees read their own assignments. Also adds the `checklist_items.assignment_id →
it.asset_assignments` FK that Javeria's `0027` left pending, and the `tickets.linked_asset_id →
it.assets` FK from `0025`. Also needs a name lookup inventory staff can use: `it.person_names()`
only resolves names for `it.tickets.read` holders, so the asset page and assignment history need
it widened to `it.assets.read` (coordinate with Javeria — it's her function).
**Screens**: INV-04 (assign/return forms), INV-03 Assignment history tab, INV-05 My Assets with
handover acknowledgement.
**Hand-off to Javeria**: `assignAsset` / `returnAsset`, `<AssetAssignForm>` / `<AssetReturnForm>`,
and `listOpenAssignments` for her on/offboarding checklist.
**Done when**: an asset can't be assigned twice, a return frees it with the condition recorded,
history is never overwritten, and the employee sees it under My Assets.

### Phase 4 — Repair and maintenance — ✅ done (2026-10-16; `talha_it_0005` live)
Built on INV-03: a Send for repair panel (Unassigned or In Use assets; an In Use asset stays
assigned to its holder while in repair) and a Close repair panel (resolution, cost, returned
date; the asset goes back to In Use or Unassigned), plus the Maintenance section listing the
asset's repair history. Changes go only through `it.open_maintenance` / `it.close_maintenance`
via the `openMaintenance` / `closeMaintenance` Server Actions. `vendor_id` stays empty until
Phase 7. INV-06, the Repair Log across all assets (`/it/inventory/maintenance`, `it.assets.read`),
is built too: read-only, with status / asset tag / sent-date filters.
**Migration** `talha_it_0005_asset_maintenance.sql`. Opening a maintenance record sets the asset
`In Repair`; closing it restores the previous status. `vendor_id` FK to `it.vendors` if
Javeria's vendors migration is already applied, otherwise added in the linking migration.
**Screens**: INV-06 and the INV-03 Maintenance tab.

### Phase 5 — Consumables and stock movements
**Depends on** Javeria's `it.products`.
**Migration** `talha_it_0006_stock_movements.sql`: `it.stock_movements` with the ERD note 7 check
(exactly one of `asset_id` / `product_id`), `site_id` + `company_id` (§1.3 #4), and a view
`it.v_stock_levels` (sum of in minus out per product per site). Stock Out is blocked when it would
go negative.
**Screens**: INV-07 and the INV-03 Movements tab.
**Hand-off to Javeria**: `recordStockMovement()` for consumable demands and receiving.

### Phase 6 — Valuation and depreciation
**Migration** `talha_it_0007_asset_values.sql`: `it.asset_values` and a function computing
current value / accumulated depreciation from the value type (straight-line and reducing-balance).
**Screens**: INV-03 Valuation tab.

### Phase 7 — Procurement linking
**Depends on** Javeria's vendors + receiving migrations.
**Migration** `talha_it_0008_link_procurement_fks.sql`: adds the deferred FKs (`assets.vendor_id`,
`assets.receiving_id`, and `asset_maintenance.vendor_id` if not done in Phase 4).
**Code**: `registerAssetsFromReceipt()` for her receiving step; INV-03 Origin tab (receipt →
demand trail, read-only).

### Phase 8 — Dashboard and reports
**Screens**: `<InventoryKpis>` for SCR-06 (total, in use, unassigned, in repair, retired,
warranty expiring in 30/60/90 days), INV-08 reports with CSV export (same pattern as
`admin/audit-log/export`).

### Phase 9 — Notifications and hardening
Portal + email notifications (via the existing `lib/email/graph-client.ts`, which no-ops until the
`MS_GRAPH_*` env vars are set) for: asset assigned to you, asset return recorded, warranty
expiring. RLS review pass with the tester (can a plain employee read another person's assignments?
can someone without `it.assets.assign` call `assign_asset()`?), plus `tsc` / `eslint` /
`npm run build` before the `it/dev` → `develop` PR.

---

## 6. Per-PR checklist

- [ ] Staged migration(s) in `supabase/it-migrations/talha/` with the required header
- [ ] RLS enabled on every new table, with a policy per operation
- [ ] UUID PKs, audit columns, `company_id` / `site_id` where transactional
- [ ] New permission rows include `label`
- [ ] Server Actions call `requirePermission()` / `requireActiveUser()` (defense in depth)
- [ ] Mutations write `logAuditEvent({ module: "it", … })`
- [ ] `npx tsc --noEmit`, `npx eslint`, `npm run build` pass
- [ ] Test checklist for the tester in the PR description
- [ ] Read the relevant guide in `node_modules/next/dist/docs/` before using a Next.js API not
      already used in the codebase (Next 16: `proxy.ts`, async `searchParams`, etc.)

---

## 7. Integration events (SOP §10)

| Event | Direction | Handling |
|---|---|---|
| `it.employee_offboarded` (emitted by Javeria's track) | Consumed here | `listOpenAssignments()` feeds her Return form (no automatic return, because physical recovery is required) |
| `it.asset_assigned` / `it.asset_returned` | Emitted here (optional) | Only if another module needs it; none does yet |

`core.integration_events` doesn't exist in the live DB yet, so until it does this is a direct
function call between the two IT tracks (same module, same schema), not an event.

---

## 8. Decisions

| # | Question | Status |
|---|---|---|
| 1 | Does procurement (ERD section D) belong to the inventory track? | **Decided 2026-10-12: Javeria** |
| 2 | Who owns onboarding/offboarding (section E)? | **Decided 2026-10-12: Javeria** (Talha supplies the assign/return forms it embeds) |
| 3 | Accept the ERD additions in §1.3? | **Decided 2026-10-12: accepted, including the status vocabulary (#6)** |
| 4 | What is the live `it` schema's actual content? | **Captured 2026-10-12** in `talha_it_0000`: `staff_roles`, `request_types`, `asset_types`, `asset_value_types` |
| 4a | Drop `it.staff_roles`? It's a module-local role table with hardcoded role names (Admin / IT Staff / Approver / Finance), the pattern `0019` removed portal-wide; IT access should be `it.*` permissions on portal roles instead | Open: proposed drop once confirmed empty; senior dev + Javeria |
| 4b | `public.audit_log` only accepts inserts from admins (`0004`), so IT staff actions don't get audited. Proposed core change: also allow inserts where `actor_id = current_person_id()` | Open: senior dev (core table) |
| 5 | Asset tag format (`FFL-LAP-000123`)? | **Decided 2026-10-14: asset tags are entered manually** (no enforced format; unique ignoring case; `talha_it_0007_asset_tag_manual.sql` removes the database default) |
| 6 | Who writes the shared foundation migration? | **Decided: Talha** (`talha_it_0001` → `0024`) |
| 7 | Can Javeria ship vendors + products early, so Phases 4–5 aren't blocked? | Open: Javeria |
