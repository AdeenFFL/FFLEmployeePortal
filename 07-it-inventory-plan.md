# IT Module (M2) — Inventory, Assets & Procurement
## Implementation & Development Plan (Talha's track)

Written against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11), the HR module
precedent (`06-hr-module-design.md`, migrations `0012`–`0020`), the IT BRD
(`final_doc_updated.docx`), and ERD v4 (`ERD_Employee_Portal_v4_detailed (1).pdf`, 25 tables).

| | |
|---|---|
| Module code / schema | `it` / `it` |
| Coarse access | `module:it` (registered by the senior dev, shared by both IT tracks) |
| This track | **Inventory**: asset register, assignments, maintenance, stock, valuation, **procurement** |
| Other track | **Service Management** (Javeria, `it/javaria`): tickets, tasks, request types, onboarding/offboarding |
| Branch flow | `it/talha` + `it/javaria` → `it/dev` (IT testing) → `develop` (senior dev) |
| Migrations | Staged in `supabase/it-migrations/talha/` (see that folder's README) |

---

## 1. Translating the ERD into portal conventions

ERD v4 models the IT system as if it were standalone: INT keys, and its own users, roles,
employees, locations, departments and audit tables. The SOP doesn't allow that (§7 rules 1–4), so
the first job is mapping each ERD concept onto what already exists.

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

### 1.3 Gaps in the ERD this plan proposes to fill (needs sign-off, see §8)

1. **`demands` has no vendor column**, but the BRD's "Vendor Assigned from Vendor Master" step
   needs one. Proposed: `demands.vendor_id` (nullable, set at the vendor-assignment step).
2. **Invoice approval has no approver record.** Only `invoices.status` exists. Proposed:
   `invoices.approved_by`, `approved_at` and `approval_comments`, or reuse a generic approvals table.
3. **Delivery Challan / Gate Pass files** have no storage column. Proposed: one generic
   `it.documents` table (`entity_type`, `entity_id`, `doc_type`, `storage_path`) and a private
   `it-documents` Storage bucket.
4. **Stock is per-site, not global.** `stock_movements` needs `site_id` (+ `company_id`), otherwise
   consumable stock levels can't be answered per plant.
5. **`products` → `asset_types` link.** Without it, receiving a fixed-asset demand can't
   auto-create an asset record. Proposed: `products.asset_type_id` (nullable).
6. **Asset status vocabulary conflicts in the BRD**: "Available / Assigned / Under Repair" (as-is
   process) vs "In Use / In Repair / Retired / Unassigned" (scope and screen list). Proposed: use
   the scope list, plus `Disposed` / `Lost` for write-offs.
7. **Current holder uniqueness.** ERD note 1 says the holder is the assignment with no return
   date. Enforce it with a partial unique index:
   `unique (asset_id) where return_date is null`.

---

## 2. Ownership split with Javeria

| ERD section | Tables | Owner |
|---|---|---|
| A — Org & Access | (core tables, §1.1) | Senior dev (no IT work) |
| B — Ticketing | `tickets`, `ticket_tasks`, `request_types` | Javeria |
| C — Asset & Inventory | `assets`, `asset_types`, `asset_assignments`, `asset_values`, `asset_value_types`, `asset_maintenance`, `stock_movements` | **Talha** |
| D — Procurement | `products`, `vendors`, `demands`, `demand_approvals`, `receiving_records`, `invoices`, `payments` | **Talha** (proposed; confirm, §8) |
| E — Onboarding/Offboarding | `onboarding_offboarding`, `checklist_items` | Javeria (proposed; confirm, §8) |
| F — Audit | `public.audit_log` | Shared helper, already exists |

### 2.1 Contracts between the two tracks

These are the places our code touches each other's tables. Agree on them before either of us
writes the matching migration.

| Contract | Direction | What's agreed |
|---|---|---|
| `tickets.linked_asset_id → it.assets(id)` | Javeria depends on Talha | `it.assets` must be applied before her tickets migration, or she adds the FK in a later file |
| `checklist_items.assignment_id → it.asset_assignments(id)` | Javeria depends on Talha | Same ordering rule |
| Asset Assignment Form / Asset Return Form | Talha builds, Javeria calls | Exported Server Actions `assignAsset()` / `returnAsset()` + a reusable `<AssetAssignForm>` that her onboarding/offboarding checklist embeds |
| `asset_maintenance.vendor_id`, `receiving_records.vendor_id` | Talha-internal | `it.vendors` lives in this track |
| Asset detail → "linked tickets" tab | Talha reads Javeria's table | Read-only query on `it.tickets where linked_asset_id = …` |
| `/it/dashboard` (SCR-06) | Shared page | Javeria owns the page; Talha supplies an `<InventoryKpis>` component |
| `/it/admin/roles` (module role-permissions) | Shared page | Built once (copy `hr/admin/roles`), one section per track |
| Foundation migration (schema, grants, `module:it`) | Shared | Written once by whoever starts first, staged in **that** author's folder; the other lists it under `Depends on` |
| Shared files (`sidebar.tsx`, `route-permissions.ts`, `home-path.ts`, `types/database.ts`) | Both edit | Keep each edit small and in its own block; regenerate `types/database.ts` on `it/dev` after merges, not on feature branches |

---

## 3. Permissions (`it.*`)

Following the per-operation style HR moved to in `0017` (`<module>.<resource>.<op>`). Every
insert must include `label`, because `0020` made `permissions.label` NOT NULL.

| Key | Label | Gates |
|---|---|---|
| `module:it` | IT | Opening `/it/**` at all. Grant to the base Employee role (employees need My Assets / raise demand) |
| `it.assets.read` | View Asset Register | `/it/inventory`, asset detail |
| `it.assets.create` | Register Assets | Add asset |
| `it.assets.update` | Edit Assets | Edit, change status |
| `it.assets.delete` | Retire/Delete Assets | Soft delete |
| `it.assets.assign` | Assign/Return Assets | Assignment + return forms |
| `it.maintenance.update` | Log Repairs | R&M log |
| `it.stock.update` | Record Stock Movements | Stock in/out |
| `it.valuation.update` | Manage Valuations | Asset values, value types |
| `it.inventory_settings.update` | Inventory Settings | Asset types, value types |
| `it.vendors.update` | Manage Vendors | Vendor master |
| `it.products.update` | Manage Products | Product master |
| `it.demands.create` | Raise Demands | New demand |
| `it.demands.read` | View All Demands | Demand queue (own demands are visible without this) |
| `it.demands.approve` | Approve Demands | Department-head decision |
| `it.demands.update` | Process Demands | Vendor assignment, receiving |
| `it.invoices.update` | Manage Invoices | Log/verify invoices |
| `it.invoices.approve` | Approve Invoices | Department-head invoice approval |
| `it.payments.update` | Record Payments | Finance confirmation, payment reference |
| `it.manage_role_permissions` | IT Role Permissions | `/it/admin/roles` (shared with Javeria) |

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
| INV-02 | `/it/procurement/vendors` | IT / procurement | Vendor master: list, add, edit, deactivate |
| INV-03 | `/it/procurement/products` | IT / procurement | Product master: name, category, unit, prices, asset type link, active |
| SCR-05 | `/it/inventory` | IT | Asset register: search by tag/serial/holder; filter by type, status, site, company; add asset |
| INV-04 | `/it/inventory/new`, `/it/inventory/[id]/edit` | IT | Asset form (BRD §5.5.1 fields); tag auto-generated |
| INV-05 | `/it/inventory/[id]` | IT | Asset detail with tabs: Overview · Assignment history · Maintenance · Valuation · Movements · Linked tickets |
| INV-06 | modal on INV-05 (+ embeddable) | IT | Asset Assignment Form and Asset Return Form (BRD fields) |
| INV-07 | `/it/my-assets` | Every employee | Assets currently assigned to me; acknowledge handover |
| INV-08 | `/it/inventory/maintenance` | IT | Repair & maintenance log across all assets, plus "send for repair" / "returned from repair" |
| INV-09 | `/it/inventory/stock` | IT | Consumable stock levels per site; Stock In / Stock Out form; movement history |
| INV-10 | `/it/procurement/demands` | Requester / IT | My demands + queue (with `it.demands.read`); new demand form (DMD-xxxxxx) |
| INV-11 | `/it/procurement/demands/[id]` | IT | Demand lifecycle: approval → vendor → receiving → documents → invoice → payment, as a timeline |
| INV-12 | `/it/procurement/approvals` | Dept head | Pending demands and invoices awaiting my decision |
| INV-13 | `/it/inventory/reports` | IT mgmt | Inventory status, utilisation, warranty expiry, maintenance cost; CSV export |
| SCR-06 (part) | `/it/dashboard` | IT | Inventory KPI cards + asset-status breakdown (component inside Javeria's page) |
| — | `/it/admin/roles` | IT admin | Shared with Javeria (§2.1) |

UI follows the HR pages: server components that query with `.schema("it")`, Server Actions with
`requirePermission()` / `requireActiveUser()`, `PageHeader`, `Modal`, `StatusPill`, and
`has_permission` RPCs to hide controls the viewer can't use.

---

## 5. Phased delivery

Each phase is one PR from `it/talha` into `it/dev`: one or more staged migrations, the screens,
the Server Actions, and a test checklist for the tester. Phases are ordered by data dependency.

### Phase 0 — Alignment and setup (no feature code)
- [ ] **Capture the live `it` schema baseline.** The `it` schema was created directly in Supabase
      and isn't in any migration file. It also isn't on the Exposed Schemas list, so the app (and
      a REST probe) can't see it. Dump it (`supabase db dump --schema it`, or Dashboard SQL) and
      commit it as `talha_it_0000_baseline_live_snapshot.sql`, marked "Applied: YES (pre-existing)".
      Then diff it against §1. If it contains ERD-style `users`/`roles`/`employees`/INT keys, it
      needs a rework migration before anything is built on top of it.
- [ ] Confirm the §8 decisions with Javeria and the senior dev.
- [ ] Senior dev: register `module:it`, add `it` to Exposed Schemas, and create `it/dev` from the
      current base.
- [ ] Agree on the foundation-migration author and the §2.1 contracts with Javeria.

### Phase 1 — Foundation and master data
**Migration** `talha_it_0001_foundation.sql` (or Javeria's equivalent): schema grants mirroring
`0012` (`grant usage` + default privileges for `authenticated`), number-generator helper
(`it.next_number('DMD')` backed by sequences, also usable for Javeria's `ONB-`/`OFB-`/ticket
numbers), and `it.*` permission rows with labels.
**Migration** `talha_it_0002_inventory_masters.sql`: `asset_types`, `asset_value_types`,
`vendors`, `products`, with RLS (read: `module:it`; write: the matching `.update` key) and seeds
for asset types (Laptop, Desktop, Monitor, Printer, Server, Network, Mobile, Peripheral,
Software License; Fixed vs Consumable).
**Screens**: INV-01, INV-02, INV-03, plus the `/it/admin/roles` section.
**Shared-file edits**: IT nav group in `sidebar.tsx`, IT entries in `route-permissions.ts`.
**Done when**: an IT admin can maintain all four masters and a non-IT employee can't reach them
(proxy and RLS both).

### Phase 2 — Asset register
**Migration** `talha_it_0003_assets.sql`: `it.assets` (tag auto-generated, e.g. `FFL-LAP-000123`;
unique `asset_tag` and `serial_number`; `company_id`, `site_id`, `status`, `condition`,
`warranty_expiry`, `vendor_id`, `receiving_id` (FK added in Phase 7), `deleted_at`).
**Screens**: SCR-05, INV-04, INV-05 (Overview tab).
**Done when**: assets can be registered, searched by tag/serial, filtered and edited, and every
change writes an audit-log row.

### Phase 3 — Assignment, return and My Assets
**Migration** `talha_it_0004_asset_assignments.sql`: `it.asset_assignments` with the partial
unique index (§1.3 #7); a security-definer `it.assign_asset()` / `it.return_asset()` pair that
writes the assignment row and flips `assets.status` atomically, so the two can't drift; RLS that
lets employees read their own assignments.
**Screens**: INV-06 (assign/return forms), INV-05 Assignment history tab, INV-07 My Assets with
handover acknowledgement.
**Hand-off to Javeria**: export `assignAsset` / `returnAsset` and `<AssetAssignForm>` for her
onboarding/offboarding checklist.
**Done when**: an asset can't be assigned twice, a return frees it with the condition recorded,
history is never overwritten, and the employee sees it under My Assets.

### Phase 4 — Repair and maintenance
**Migration** `talha_it_0005_asset_maintenance.sql`. Opening a maintenance record sets the asset
`In Repair`; closing it restores the previous status.
**Screens**: INV-08 and the INV-05 Maintenance tab.

### Phase 5 — Consumables and stock movements
**Migration** `talha_it_0006_stock_movements.sql`: `it.stock_movements` with the ERD note 7 check
(exactly one of `asset_id` / `product_id`), `site_id`, `company_id`, and a view
`it.v_stock_levels` (sum of in minus out per product per site). Stock Out is blocked when it would
go negative.
**Screens**: INV-09 and the INV-05 Movements tab.

### Phase 6 — Valuation and depreciation
**Migration** `talha_it_0007_asset_values.sql`: `it.asset_values` and a function computing
current value / accumulated depreciation from the value type (straight-line and reducing-balance).
**Screens**: INV-05 Valuation tab, value-type settings in INV-01.

### Phase 7 — Procurement: demands and approvals
**Migration** `talha_it_0008_demands.sql`: `demands` (+ `vendor_id`, §1.3 #1) and
`demand_approvals`. Status flow: `Open → Categorized → Pending Approval → Approved | Rejected |
Partially Approved → Assigned to Vendor → …`. Consumable demands take the exception path straight
to a stock movement.
**Screens**: INV-10, INV-11 (approval and vendor steps), INV-12.
**Open dependency**: who counts as "the Department Head" for a demand (§8).

### Phase 8 — Receiving and documents
**Migration** `talha_it_0009_receiving.sql`: `receiving_records`, `it.documents` + the
`it-documents` Storage bucket and policies, and the FK `assets.receiving_id`.
On receiving: a fixed-asset product creates draft asset rows linked to the receipt; a consumable
creates a Stock In movement. Full / Partial / Not Received tracking against the ordered quantity.
**Screens**: receiving and documents steps of INV-11.

### Phase 9 — Invoices and payments
**Migration** `talha_it_0010_invoices_payments.sql`: `invoices` (+ approval columns, §1.3 #2),
`payments`. Automatic quantity check of invoice vs receiving, flagged for review on mismatch.
**Screens**: invoice and payment steps of INV-11, invoice items in INV-12.

### Phase 10 — Dashboard and reports
**Screens**: `<InventoryKpis>` for SCR-06 (total, in use, unassigned, in repair, retired,
warranty expiring in 30/60/90 days), INV-13 reports with CSV export (same pattern as
`admin/audit-log/export`).

### Phase 11 — Notifications and hardening
Portal + email notifications (via the existing `lib/email/graph-client.ts`, which no-ops until the
`MS_GRAPH_*` env vars are set) for: demand awaiting approval, demand rejected/partial, asset
assigned to you, warranty expiring. RLS review pass with the tester (can a plain employee read
another person's assignments? can a non-approver approve?), plus `tsc` / `eslint` /
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
| `it.employee_offboarded` (emitted by Javeria's track) | Consumed here | List the person's open assignments for the Return form (no automatic return, because physical recovery is required) |
| `it.asset_assigned` / `it.asset_returned` | Emitted here (optional) | Only if another module needs it; none does yet |

`core.integration_events` doesn't exist in the live DB yet, so until it does this is a direct
function call between the two IT tracks (same module, same schema), not an event.

---

## 8. Decisions needed before Phase 1

| # | Question | Proposed answer | Decide with |
|---|---|---|---|
| 1 | Does procurement (ERD section D) belong to the inventory track? | Yes: assets FK into vendors and receiving, so splitting it creates cross-dependencies | Javeria, senior dev |
| 2 | Who owns onboarding/offboarding (section E)? | Javeria owns the workflow; Talha supplies the assign/return forms it embeds | Javeria |
| 3 | What is the live `it` schema's actual content? | Dump it first (Phase 0); rework if it follows the ERD literally | Whoever created it |
| 4 | Asset status vocabulary | In Use / In Repair / Retired / Unassigned (+ Disposed, Lost) | IT BA |
| 5 | Who is the "Department Head" approver for a demand or invoice? | A permission (`it.demands.approve`) scoped by department once scoped permissions exist; until then a global permission | Senior dev, IT BA |
| 6 | Accept the ERD additions in §1.3 (demand vendor, invoice approval, documents, stock site, product→asset type)? | Yes | Senior dev |
| 7 | Asset tag format | `<COMPANY>-<TYPE>-<6-digit seq>`, e.g. `FFL-LAP-000123` | IT BA |
| 8 | Who writes the shared foundation migration (`module:it`, grants, number generator)? | Whoever starts Phase 1 first | Javeria |
