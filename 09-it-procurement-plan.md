# IT Module (M2) — Procurement Demand Management
## Implementation & Development Plan (Javaria's track)

Companion to `07-it-inventory-plan.md` (Talha) and `08-it-service-management-plan.md`. Written
against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11), the IT BRD
(`final_doc_updated.docx` §2.5 as-is, §4.5 gaps, §5.5 to-be, §6.1 scope, §7.5–7.10 data fields),
and ERD v4 (`ERD_Employee_Portal_v4_detailed (1).pdf`, section D). §1 of Talha's plan (mapping the
ERD onto portal conventions) applies here too and isn't repeated.

| | |
|---|---|
| Module code / schema | `it` / `it` (shared with Talha) |
| Coarse access | `module:it` (registered on `develop` in `0021`; granted per role by an Admin) |
| This track | **Procurement**: vendor master, product master, demands, department-head approval, vendor assignment, goods receiving (Delivery Challan + Inward Gate Pass), documents, invoices, Finance processing, payments |
| Other tracks | **Inventory** (Talha, `it/talha`): assets, assignments, repairs, stock, valuation. **Service Management & On/Offboarding** (Javaria, `08`) |
| Branch flow | `IT/javaria` + `it/talha` → `IT/dev` (IT testing) → `develop` (senior dev) |
| Migrations | Staged in `supabase/it-migrations/javaria/`, continuing her numbering (`javaria_it_0009`+) |

**Decision log**
- 2026-10-12: Procurement (ERD section D) is owned by Javaria (Talha's `07` decision log).
  `08` §8 #1 had recorded it as disputed; taken on with this plan (2026-10-21).
- 2026-10-12: Talha's ERD additions accepted, including the ones this track builds: #1
  `demands.vendor_id`, #2 invoice approval columns, #3 generic `it.documents` + bucket, #5
  `products.asset_type_id` (`07` §1.3).
- Conventions decided for the other IT tracks apply here unchanged: uuid keys, `persons` instead
  of users/employees, `org_units` for departments / sites, `deleted_at` instead of hard delete,
  `company_id` + `site_id` on transactional rows, IT access as `it.*` permissions (no role tables),
  `it.next_number()` for document numbers, triggers + security-definer functions for workflow
  rules, notifications through `it.notifications`.

---

## 0. Status — 2026-10-21

Nothing built yet. **Talha is waiting on this track**:

| What Talha needs | For | His phase |
|---|---|---|
| `it.products` | `stock_movements.product_id` FK — consumable stock in / out | Phase 5 (blocked) |
| `it.vendors` | FKs `assets.vendor_id`, `asset_maintenance.vendor_id` (columns exist, no FK yet) | Phase 7 |
| `it.receiving_records` | FK `assets.receiving_id` (column exists, no FK yet) | Phase 7 |

So vendors + products ship first (Phase 1), receiving in Phase 4.

Already available to build on:
- `it.next_number(prefix)` (`0024`) → `DMD-000123` demand numbers.
- `it.notifications` + `lib/it/notifications.ts` (`0029`) → portal + email notifications,
  including `recipient_email` for people outside the portal (vendors).
- `it.site_it_staff`, `it.can_see_site_tickets()` pattern (`javaria_it_0005`) → site scoping.
- `public.audit_log` — but it only accepts inserts from full admins (`07` §8 #4b), so procurement
  keeps its own per-demand timeline (like `it.ticket_updates`).
- Talha's `assets`, `asset_types` (live); his `registerAssetsFromReceipt()` and
  `recordStockMovement()` are **not built yet** (his Phases 5 and 7) — see §2.

---

## 1. Data model

### 1.1 ERD section D → portal tables

All in `it`, uuid keys, `created_at` / `updated_at` / `created_by` / `updated_by` on every table,
`deleted_at` on demands, receiving, invoices and payments (compliance-relevant).

| ERD table | Portal table | Main columns (beyond the conventions) |
|---|---|---|
| `vendors` | `it.vendors` | `vendor_name`, `contact_person`, `contact_no`, `email`, `address`, `tax_number` (nullable), `is_active` |
| `products` | `it.products` | `product_name`, `category`, `unit`, `purchase_price`, `current_price`, `description`, `is_active`, **`asset_type_id → it.asset_types`** (nullable; set = fixed-asset product, #5) |
| `demands` | `it.demands` | `demand_number` (`DMD-`), `product_id`, `requested_by_person_id`, `department_id`, `site_id`, `company_id`, `quantity`, `justification`, `demand_category`, `status`, **`vendor_id`** (#1), `estimated_unit_price` (snapshot of the product's current price), `approved_quantity` (from the approval) |
| `demand_approvals` | `it.demand_approvals` | `demand_id`, `approver_person_id`, `decision` (Approved / Rejected / Partially Approved), `approved_quantity`, `comments`, `decided_at` |
| `receiving_records` | `it.receiving_records` | `demand_id`, `vendor_id`, `received_by_person_id`, `delivery_challan_no` (nullable), `gate_pass_no`, `received_date`, `received_quantity`, `condition`, `status` (Full / Partial / Not Received), `remarks`, `site_id`, `company_id` |
| `invoices` | `it.invoices` | `receiving_id`, `invoice_number`, `invoice_date`, `invoice_amount`, `status`, `submitted_at`, **`approved_by`, `approved_at`, `approval_comments`** (#2), `quantity_mismatch`, `amount_mismatch`, `verification_notes` |
| `payments` | `it.payments` | `invoice_id`, `payment_reference`, `payment_date`, `paid_amount`, `payment_method`, `status`, `remarks`, `vendor_notified_at` (more than one payment per invoice allowed, BRD §7.9) |

### 1.2 Additions beyond the ERD (needs sign-off, §8)

| # | Addition | Why |
|---|---|---|
| P1 | **`it.documents`** (`entity_type`, `entity_id`, `doc_type`, `storage_path`, `file_name`, `content_type`, `size_bytes`, `uploaded_by`) + private bucket `it-documents` (already accepted as `07` §1.3 #3) | One place for Delivery Challans, Gate Passes, invoices, approval sign-offs (BRD §5.5.9, §5.5.12, §5.5.16). Generic so Talha can attach files to assets later |
| P2 | **`it.demand_updates`** — per-demand timeline (status changes, approvals, vendor changes, receiving, invoice steps, comments) | BRD §5.5.20 "complete history … retained as one auditable record"; `public.audit_log` isn't writable by non-admins |
| P3 | **`it.department_approvers`** (`department_id`, `person_id`, `can_approve_demands`, `can_approve_invoices`) | BRD §5.5.4 routes to "the relevant Department Head". `has_permission()` can't say *which* department, so the mapping lives here (same idea as `it.category_owners`) |
| P4 | **`it.procurement_settings`** (single row: Finance processing SLA in days, reminder interval, consumable path on/off) | BRD §5.5.17 "automatic reminders if the invoice remains unprocessed beyond a defined SLA" |
| P5 | **Site scoping** on demands like tickets: site IT staff (`it.site_it_staff`) see their site's demands; HQ / Finance see all (`it.demands.read_all`) | Same decision as tickets (`08` Phase 6): Bhalwal doesn't see Cereals |

### 1.3 Statuses

**Demand** (BRD §5.5 statuses, in order):
`Open → Categorized → Pending Approval → Approved | Partially Approved | Rejected →
Assigned to Vendor → Partially Received | Received → Invoicing → Closed`, plus `Cancelled`.
Consumable exception path (§5.5.3): `Categorized → Stock Updated → Closed`, no approval / vendor.

**Invoice**: `Logged → Verified | Flagged → Pending Approval → Approved | Revise →
Sent to Finance → Confirmed → Paid`.

**Payment**: `Recorded → Reference Sent to Vendor`.

Status moves are enforced in the database (before-update triggers, same pattern as tickets):
e.g. a demand can't reach `Assigned to Vendor` without an approval row, can't be `Received`
without receiving records whose quantities add up, an invoice can't be `Approved` while flagged.

### 1.4 Automatic checks (BRD §5.5.8, §5.5.13)

- **Receiving vs demand**: sum of `received_quantity` vs `approved_quantity` (or `quantity`)
  decides `Partially Received` / `Received`; a shortfall stays visible on the demand and
  schedules a follow-up reminder.
- **Invoice vs receiving**: invoice quantity / amount compared with what was received
  (`received_quantity × estimated_unit_price`, tolerance in settings); a mismatch sets
  `Flagged` with the reason, and approval is blocked until a verifier clears it with a note.

---

## 2. Contracts with Talha (mirror of `07-it-inventory-plan.md` §2.1)

**Talha's tables that reference this track's** — this track ships the targets, he adds the FKs:

| FK on his side | Target here | Ships in | Then |
|---|---|---|---|
| `stock_movements.product_id` | `it.products` | Phase 1 | Unblocks his Phase 5 |
| `assets.vendor_id`, `asset_maintenance.vendor_id` | `it.vendors` | Phase 1 | His Phase 7 linking migration |
| `assets.receiving_id` | `it.receiving_records` | Phase 4 | His Phase 7 linking migration |

**This track's tables that reference Talha's**

| FK | Target | Rule |
|---|---|---|
| `products.asset_type_id` | `it.asset_types` | Live already (`0026`) — added directly in Phase 1 |

**Functions Talha provides, called from this track**

| From Talha | Called from | Until it exists |
|---|---|---|
| `recordStockMovement({ productId, siteId, type, qty, reference })` | Consumable demand (§5.5.3) and receiving consumables | Consumable demands stop at `Approved` with a "stock entry pending" note; switched on when his Phase 5 ships |
| `registerAssetsFromReceipt(receivingId, …)` → draft asset rows | Receiving a fixed-asset product (§5.6.10) | Receiving records the serials in remarks; assets registered by hand on `/it/inventory/new`, linked once his Phase 7 ships |

**What Talha reads from this track**: the receipt → demand trail for his asset "Origin" section
(read-only), vendor names for assets and repairs.

**Keeping in touch**: any change to a row above is agreed with Talha first and updated in
**both** plan files in the same PR.

---

## 3. Permissions (this track)

`<module>.<resource>.<op>` style; every insert includes `label`; all manageable on
`/it/admin/roles` (IT Roles & Permissions).

| Key | Label | Gates |
|---|---|---|
| `it.vendors.update` | Manage Vendors | Vendor master: add, edit, deactivate |
| `it.products.update` | Manage Products | Product master: add, edit, prices, asset-type link, deactivate |
| `it.demands.create` | Raise Demands | New demand (Site Support Team) |
| `it.demands.read` | View Demands | Demand queue for the viewer's site(s); own demands visible without it |
| `it.demands.read_all` | View All Sites' Demands | Every site (HQ procurement, Finance, HOD IT) |
| `it.demands.update` | Process Demands | Categorise, assign vendor, record receiving, upload DC / gate pass |
| `it.demands.approve` | Approve Demands | Department-head decision — only for departments the person is mapped to (P3) |
| `it.invoices.update` | Manage Invoices | Log invoice, upload file, clear a flagged mismatch |
| `it.invoices.approve` | Approve Invoices | Department-head invoice approval (mapped departments only) |
| `it.payments.update` | Finance Processing | Confirm receipt of the invoice package, record payment reference / payments |
| `it.procurement_settings.update` | Procurement Settings | Department approvers, Finance SLA, tolerances |

Gate-pass entry by **Security Guard / Admin** (BRD §5.5.9): they record the Inward Gate Pass on
the demand — covered by `it.demands.update` scoped to the "Receiving" step, or a narrower
`it.gate_pass.update` if the BA wants guards to see nothing else (§8 #5).

---

## 4. Screen inventory (this track)

Routes under `app/(protected)/it/procurement/`.

| ID | Route | Who | Purpose |
|---|---|---|---|
| PRC-01 | `/it/procurement/vendors` | Procurement / IT | Vendor master: list, search, add, edit, deactivate; IT Manager sees contact + tax details (gap 4.5 #5) |
| PRC-02 | `/it/procurement/products` | Procurement / IT | Product master: name, category, unit, purchase / current price, asset type link, active (gap 4.5 #7) |
| PRC-03 | `/it/procurement/demands` | Site Support / IT | Demand queue (site-scoped), filters by status / category / site / department / date; KPI strip (open, awaiting approval, awaiting delivery, overdue at Finance) |
| PRC-04 | `/it/procurement/demands/new` | Site Support | Raise demand: product from master, department, site, quantity, justification, category → `DMD-000123` |
| PRC-05 | `/it/procurement/demands/[id]` | Everyone involved | The demand's lifecycle on one page, step by step: details → approval → vendor → receiving (DC, gate pass, quantities, shortfall) → documents → invoice(s) → Finance → payment(s) → timeline. Each step shows who did it and when; only the next allowed action is offered |
| PRC-06 | `/it/procurement/approvals` | Department heads | My inbox: demands and invoices awaiting my decision (Approve / Partially approve with quantity / Reject with comments) |
| PRC-07 | `/it/procurement/finance` | Finance | Invoice packages sent to Finance, SLA ageing, Confirm, record payment + reference (auto-emailed to the vendor) |
| PRC-08 | `/it/procurement/settings` | IT admin | Department approvers (P3), Finance SLA and reminder interval, verification tolerance |
| PRC-09 | `/it/procurement/reports` | IT mgmt / Finance | Demand cycle time, spend by vendor / department / site, receiving shortfalls, invoices pending at Finance; CSV export (same pattern as `/it/reports`) |
| SCR-06 (part) | `/it/dashboard` | IT | `<ProcurementKpis>`: open demands, awaiting approval, awaiting delivery, invoices overdue at Finance |

---

## 5. Phased delivery

Each phase is one PR from `IT/javaria` into `IT/dev`: staged migration(s), screens, Server
Actions, and a test checklist for the tester. Ordered by what unblocks Talha first.

### Phase 0 — Alignment (no feature code)
- [ ] Confirm §8 #1–#6 with the IT BA / senior dev (department heads, Finance users, gate pass,
      statuses, tolerance, site scoping).
- [ ] Agree the §2 contracts with Talha; tell him the order: products + vendors first.

### Phase 1 — Vendor & product masters *(unblocks Talha Phases 5 and 7)*
**Migration** `javaria_it_0009_procurement_masters.sql`: `it.vendors`, `it.products` (with
`asset_type_id → it.asset_types`), RLS (read: `module:it`; write: `it.vendors.update` /
`it.products.update`), permission rows with labels, and `it.procurement_settings`.
**Screens**: PRC-01, PRC-02; "Procurement" section in the IT sidebar.
**Done when**: vendors and products can be maintained; Talha can add his `stock_movements` and
`vendor_id` FKs.

### Phase 2 — Demands, categorisation and the consumable path
**Migration** `javaria_it_0010_demands.sql`: `it.demands` (`DMD-` numbers via `it.next_number`),
`it.demand_updates` (timeline), status trigger, site-scoped RLS (`it.site_it_staff` like tickets),
`it.demands.*` permissions, notifications (new demand → site's procurement staff).
Consumable category: no approval / vendor; calls Talha's `recordStockMovement()` when available
(§2), otherwise held at "stock entry pending".
**Screens**: PRC-03, PRC-04, PRC-05 (details + timeline).

### Phase 3 — Department-head approval
**Migration** `javaria_it_0011_demand_approvals.sql`: `it.demand_approvals`,
`it.department_approvers` (P3), routing on submit (→ `Pending Approval`, notify the department's
approvers), decision function (Approved / Partially Approved with quantity / Rejected, comments,
timestamp captured automatically — BRD §5.5.5), Site IT notified on reject / partial (§5.5.6).
**Screens**: PRC-06, approval step on PRC-05, approvers on PRC-08.

### Phase 4 — Vendor assignment, receiving and documents *(unblocks Talha Phase 7)*
**Migration** `javaria_it_0012_receiving_documents.sql`: vendor assignment from the master
(→ `Assigned to Vendor`), `it.receiving_records` (Full / Partial / Not Received against the
approved quantity, shortfall + follow-up reminder, re-assign to another vendor — BRD §5.6.8),
`it.documents` + `it-documents` bucket (DC, gate pass), Inward Gate Pass entry.
Fixed-asset products → Talha's `registerAssetsFromReceipt()` (or the interim in §2).
**Then**: tell Talha `it.receiving_records` is live so he can add `assets.receiving_id`.
**Screens**: vendor, receiving and documents steps on PRC-05.

### Phase 5 — Invoices
**Migration** `javaria_it_0013_invoices.sql`: `it.invoices` (+ approval columns), auto-
verification against receiving (§1.4 → `Verified` / `Flagged`), routing to the department head
(→ `Pending Approval`), approve / send back for revision with the reason logged (§5.5.15),
invoice package compiled from the demand's documents (§5.5.16) and sent to Finance.
**Screens**: invoice step on PRC-05, invoice items in PRC-06.

### Phase 6 — Finance processing and payments
**Migration** `javaria_it_0014_payments.sql`: `it.payments`, Finance confirmation, SLA tracking
and reminders (pg_cron sweep, same pattern as `it.notify_sla_breaches()`), payment reference
**emailed to the vendor** (`it.notifications.recipient_email`), demand closed end-to-end with the
full history (§5.5.20).
**Screens**: PRC-07, payment step on PRC-05.

### Phase 7 — Dashboard and reports
**Screens**: PRC-09 with CSV export, `<ProcurementKpis>` on `/it/dashboard`.

### Phase 8 — Hardening
RLS review with the tester (can a site see another site's demands? can a department head approve
a department they don't head? can anyone edit an approved quantity after approval? can a guard
see invoice amounts?), notification wording, `tsc` / `eslint` / `npm run build` before the
`IT/dev` → `develop` PR.

---

## 6. Per-PR checklist

Same as `07-it-inventory-plan.md` §6, with the folder `supabase/it-migrations/javaria/` and file
names `javaria_it_<NNNN>_<description>.sql`; plus:
- [ ] Every money column is `numeric(12,2)`; amounts never computed in the browser
- [ ] Uploaded documents go to the private `it-documents` bucket only, readable by people who can
      see the demand

---

## 7. Integration events

| Event | Direction | Handling |
|---|---|---|
| `it.receiving_recorded` (fixed-asset product) | Emitted here → Talha | `registerAssetsFromReceipt()` (direct call until `core.integration_events` exists) |
| `it.consumable_issued` / `it.consumable_received` | Emitted here → Talha | `recordStockMovement()` |
| `finance.payment_referenced` | Future | Only if a Finance module appears; today Finance works inside this screen |

---

## 8. Decisions needed before Phase 1–3

| # | Question | Proposed answer | Decide with |
|---|---|---|---|
| 1 | Who is "the Department Head" for a demand / invoice? | Mapping table `it.department_approvers` (P3), maintained on PRC-08; a person can head several departments | IT BA, senior dev |
| 2 | Who are the Finance users? | A role holding `it.payments.update` + `it.demands.read_all` | IT BA |
| 3 | Do guards / Admin record the gate pass in the portal? | Yes, with a narrow `it.gate_pass.update` if they must not see amounts | IT BA |
| 4 | Accept additions P1–P5 (documents, timeline, department approvers, settings, site scoping)? | Yes | Senior dev |
| 5 | Invoice-vs-receiving tolerance (amount) | 0 for quantity; ±1% or a fixed amount for rounding | IT BA / Finance |
| 6 | Does a partially-received demand allow one invoice per delivery, or one at the end? | One invoice per receiving record (ERD: `invoices.receiving_id`) | IT BA / Finance |
| 7 | Do vendors get emails (payment reference, order) from the portal? | Yes for the payment reference (§5.5.19), via the existing Graph mailer | IT BA |
| 8 | "Open" demand category (BRD lists Consumable / Open / Repair / Maintenance / Fix) — what does "Open" mean? | Treat as "general purchase" until the BA defines it | IT BA |
