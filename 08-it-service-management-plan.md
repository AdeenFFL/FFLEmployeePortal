# IT Module (M2) — Service Management, Tickets & Onboarding/Offboarding
## Implementation & Development Plan (Javeria's track)

Companion to Talha's `07-it-inventory-plan.md`. Same conventions, same branch flow, same staged
migration rules. Where the two tracks meet, this plan points to the matching row in his §2.1
rather than restating it, so the two documents stay consistent.

Written against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11), the IT BRD
(`final_doc_updated.docx` §5.1–5.3, §7.1, §7.3, §8), and ERD v4
(`ERD_Employee_Portal_v4_detailed (1).pdf`, sections B and E).

| | |
|---|---|
| Module code / schema | `it` / `it` (shared with Talha) |
| Coarse access | `module:it` (shared by both IT tracks) |
| This track | **Service Management**: tickets, ticket tasks, request types, SLAs, onboarding/offboarding, IT dashboard |
| Other track | **Inventory & Procurement** (Talha, `it/talha`): assets, assignments, maintenance, stock, valuation, procurement |
| Branch flow | `IT/javaria` + `it/talha` → `IT/dev` (IT testing) → `develop` (senior dev) |
| Migrations | Staged in `supabase/it-migrations/javeria/` (see that folder's README) |

---

## 1. Translating the ERD into portal conventions

Same rules as `07-it-inventory-plan.md` §1.1–1.2: no `it.users` / `it.roles` / `it.employees` /
`it.departments` / `it.locations` / `it.audit_log`; uuid keys; every `*_user_id` /
`*_employee_id` becomes `*_person_id → public.persons(id)`; departments and locations are
`public.org_units`; `created_at` / `updated_at` / `created_by` / `updated_by` on every table.

### 1.1 What already exists in the live `it` schema

Created directly in Supabase, not yet in any migration file (Talha's Phase 0 baseline snapshot
captures these):

| Table | Columns | Used by this track |
|---|---|---|
| `request_types` | id, name, applies_to, description, is_active, created_at, updated_at | **Yes**: ticket types and onboarding/offboarding/replacement types (ERD note 8) |
| `staff_roles` | person_id, role, created_at, created_by | **Open question, see §8 #1**: values are IT Executive / Site Manager |
| `asset_types`, `asset_value_types` | — | No (Talha's track) |

This track **reuses** `it.request_types` as-is and never re-creates the schema or these tables.

### 1.2 Gaps in the ERD this plan proposes to fill (needs sign-off, see §8)

1. **Subcategory.** BRD §5.3.1 asks for Category and Subcategory; the ERD has a single
   `tickets.category` varchar. Proposed: `it.ticket_categories` with `parent_id` (one level deep),
   and `tickets.category_id` + `tickets.subcategory_id`.
2. **SLA targets.** BRD §5.3.8 applies SLAs by priority; the ERD has only `tickets.deadline`.
   Proposed: `it.sla_policies` (priority → response hours, resolution hours). The ticket's
   `response_due_at` / `resolution_due_at` are computed by trigger, never by the app.
3. **Ticket timeline.** BRD §5.3.9 requires every step, work note and update to be recorded on
   the ticket. Proposed: `it.ticket_updates` (comment / internal work note / status change /
   assignment / priority change / escalation), status/assignment rows written by trigger.
4. **Multiple attachments.** ERD has one `attachment_path`. Proposed: `it.ticket_attachments` and
   a private `it-ticket-attachments` Storage bucket (path `{ticket_id}/…`, access follows the
   ticket). Can share Talha's `it.documents` table instead if he builds it first (his §1.3 #3).
5. **Escalation, first response, satisfaction.** Gaps 4.3 #10, #13, #15 and BRD §5.3.11/§5.3.14
   need `first_responded_at`, `is_escalated` / `escalated_at` / `escalation_reason`,
   `root_cause`, `reopen_count`, `requester_confirmed_at`, `satisfaction_rating`.
6. **Extra BRD §5.3.1 form fields** not in the ERD: requested-for person, asset/system name,
   access required, manager approval required, preferred contact method, remarks, department.
7. **Ticket statuses.** BRD uses Open / In Progress / Resolved / Closed plus "Assigned".
   Proposed: `Open → Assigned → In Progress ⇄ On Hold → Resolved → Closed` (Resolved → In Progress
   = reopen). Priorities: `Critical / High / Medium / Low` (BRD §5.3.6; §7.1 lists only three).

### 1.3 Two base-layer limitations this track has to work around

- `public.persons` is readable only by the person themself and admins, so an employee can't see
  their engineer's name and IT staff can't see requester names. **Proposed:** narrow
  security-definer functions inside `it` (`it.person_names(ids)`, `it.list_it_staff()`), not a
  change to the base `persons` policy.
- `public.org_units` is admin-only, so the ticket form can't list sites/departments.
  **Proposed:** `it.list_org_units()` (security definer, active rows, requires `module:it`).

---

## 2. Ownership and contracts with Talha

Ownership matches `07-it-inventory-plan.md` §2. This track owns ERD section B (tickets,
ticket_tasks, request_types) and section E (onboarding_offboarding, checklist_items).

| Contract (Talha §2.1) | What this track does |
|---|---|
| `tickets.linked_asset_id → it.assets(id)` | Column created as a plain `uuid` in the tickets migration; FK added in a later file once `it.assets` exists. Picker on the ticket form appears only after that. |
| `checklist_items.assignment_id → it.asset_assignments(id)` | Same ordering rule. Onboarding/offboarding (Phase 4) starts after Talha's Phase 3. |
| Asset Assignment / Return Forms | **Consumed here**: onboarding/offboarding checklist embeds Talha's `<AssetAssignForm>` and calls `assignAsset()` / `returnAsset()`. No asset writes from this track. |
| Asset detail → "linked tickets" tab | Talha reads `it.tickets where linked_asset_id = …`; this track keeps that column and its index stable. |
| `/it/dashboard` (SCR-06) | **Owned here.** Ticket KPIs from this track; Talha's `<InventoryKpis>` dropped in as a component. |
| `/it/admin/roles` | Shared page, one section per track. |
| Foundation migration (grants, `module:it`, number generator) | Whoever starts first. If this track goes first: `javeria_it_0001_foundation.sql`, including Talha's proposed `it.next_number(prefix)` so both tracks use one numbering helper (`IT-`, `ONB-`, `OFB-`, `DMD-`). |
| Event `it.employee_offboarded` | **Emitted here** when an offboarding request completes (Talha §7). Direct function call until `core.integration_events` exists. |
| Shared files (`sidebar.tsx`, `route-permissions.ts`, `types/database.ts`) | Small, separate blocks; `types/database.ts` regenerated on `IT/dev` after merges. |

**Keeping in touch:** any change to a contract row above is agreed with Talha first and updated
in **both** plan files in the same PR.

---

## 3. Permissions (`it.*`)

Same `<module>.<resource>.<op>` style as Talha's §3; every insert includes `label`.

| Key | Label | Gates |
|---|---|---|
| `module:it` | IT | Shared with Talha. Raise tickets, see own tickets. Granted to every role. |
| `it.tickets.read` | View IT Ticket Queue | `/it/tickets`, all tickets incl. internal notes |
| `it.tickets.update` | Work on IT Tickets | Status, work notes, resolution, tasks on tickets assigned to you; appear in assignee list |
| `it.tickets.assign` | Assign & Prioritise IT Tickets | Assign any ticket, change priority, escalate (IT Executive) |
| `it.tickets.close` | Close IT Tickets | Formal closure |
| `it.ticket_settings.update` | Ticket Settings | Categories, request types, SLA targets |
| `it.onboarding.create` | Raise Onboarding/Offboarding | HR raising ONB/OFB requests |
| `it.onboarding.read` | View Onboarding/Offboarding | Checklist queue |
| `it.onboarding.update` | Work Onboarding/Offboarding | Complete checklist items |
| `it.onboarding.approve` | Final Review (HOD IT) | Offboarding final review and sign-off (BRD §5.2.13–14) |
| `it.manage_role_permissions` | IT Role Permissions | Shared with Talha |

Workflow rules (who may assign, close, resolve without notes, edit a closed ticket) are
enforced by triggers in the database, not only hidden in the UI.

**If §8 #1 goes the other way** (use `it.staff_roles` instead), the same capabilities map to:
IT Executive = read + update + assign + close; Site Manager = read + update, scoped to their
site and to tickets assigned to them.

---

## 4. Screen inventory (this track)

| ID | Route | Who | Purpose |
|---|---|---|---|
| SCR-01 | `/it/my-tickets/new` | Every employee | Raise ticket (BRD §5.3.1 fields + attachments); confirmation shows `IT-xxxxxx` |
| SCR-02 | `/it/my-tickets` | Every employee | My tickets: number, category, priority, submitted, status |
| SCR-02b | `/it/my-tickets/[id]` | Every employee | Ticket detail, public timeline, comment, **Confirm resolution** (rating) / **Reopen** |
| SCR-03 | `/it/tickets` | IT staff | Ticket queue: filter by status, priority, category, assignee (mine / unassigned / all), date; SLA due/overdue and escalated flags |
| SCR-03b | `/it/tickets/[id]` | IT staff | Workspace: triage (assign, priority, category), status, resolve (notes + root cause), escalate, close, tasks, full timeline incl. internal notes |
| ITSM-01 | `/it/settings/tickets` | IT admin | Categories / subcategories, request types, SLA targets |
| SCR-04 | `/it/onboarding` | IT | Onboarding / offboarding / replacement checklists (BRD §5.1, §5.2) |
| ITSM-02 | `/it/onboarding/new` | HR | Raise ONB / OFB request (BRD §5.1.1, §5.2.1 fields) |
| ITSM-03 | `/it/onboarding/[id]` | IT / HOD IT | Checklist items with owner + timestamp, embedded asset forms, final review and sign-off |
| SCR-06 | `/it/dashboard` | IT | KPIs: open tickets, avg resolution time, SLA compliance, pending ONB/OFB tasks; tickets by category; 90-day volume trend; `<InventoryKpis>` from Talha |
| ITSM-04 | `/it/reports` | IT mgmt | Ticket Volume Report (§7.12) and SLA Compliance Report (§7.13), CSV export |

Routes stay under `app/(protected)/it/`. Employee pages and IT pages are separate routes so
`route-permissions.ts` can gate them by prefix (`/it/my-tickets` → `module:it`,
`/it/tickets` → `it.tickets.read`).

---

## 5. Phased delivery

Each phase is one PR from `IT/javaria` into `IT/dev`: staged migration(s), screens, Server
Actions, and a test checklist for the tester.

### Phase 0 — Alignment (no feature code)
- [ ] Decide §8 #1 (`staff_roles` vs permissions) with Talha and the senior dev.
- [ ] Confirm who writes the foundation migration (Talha §8 #8).
- [ ] Confirm the live `it` baseline snapshot (Talha's Phase 0) is committed, so this track's
      migrations can list it under `Depends on`.
- [ ] `it` added to Supabase Exposed Schemas.

### Phase 1 — Ticketing core
**Migration** `javeria_it_0001_foundation.sql` (only if Talha hasn't already): grants, `module:it`,
`it.next_number()`.
**Migration** `javeria_it_0002_tickets.sql`: `ticket_categories` (+ seeds from BRD §5.3.5 and
§2.4.3), `sla_policies` (+ placeholder targets), `tickets`, `ticket_updates`, `ticket_tasks`,
`ticket_attachments` + bucket, triggers (clean insert state, SLA computation, workflow rules,
timeline logging, first response), requester functions `it.confirm_ticket_resolution()` /
`it.reopen_ticket()`, the §1.3 helper functions, RLS, `it.*` ticket permission rows, seed ticket
request types (Incident, Service Request, Access Request, Asset Request).
**Screens**: SCR-01, SCR-02, SCR-02b, SCR-03, SCR-03b.
**Shared-file edits**: "IT Tickets" base nav item + "IT Service Management" nav group;
route-permission entries; `next.config.ts` `serverActions.bodySizeLimit` for attachments.
**Done when**: an employee can raise, track, comment, confirm or reopen; an IT executive can
assign, prioritise, escalate and close; an IT team member can work and resolve only tickets
assigned to them; a plain employee can't read anyone else's ticket or any internal note
(proxy and RLS both).

### Phase 2 — Settings
**Screens**: ITSM-01 (categories, request types, SLA targets).
**Done when**: IT admin can change SLA hours and new tickets pick them up.

### Phase 3 — Dashboard and reports
**Screens**: SCR-06, ITSM-04 (ticket volume by category / priority / month; SLA compliance by
category with Met / Breached; KPIs from BRD §5.3.18: first response time, resolution time, SLA
compliance, closure rate, ageing, escalation rate, technician productivity).

### Phase 4 — Onboarding / Offboarding (after Talha's Phase 3)
**Migration** `javeria_it_0003_onboarding_offboarding.sql`: `onboarding_offboarding` (ONB-/OFB-
numbers, request type, employee, category Permanent/Contractual, location, due date, status),
`checklist_items` (owner, status, due, completed_at, `assignment_id` FK to Talha's
`asset_assignments`), routing by location (HQ team vs plant-site team, BRD §5.2.4), checklist
completion gate before final review (BRD §5.2.12), HOD IT sign-off record (BRD §5.2.14),
employee confirmation (BRD §5.1.13), seed request types (Onboarding, Offboarding, Replacement).
**Screens**: SCR-04, ITSM-02, ITSM-03.
**Open dependency**: who writes employment status on offboarding — HR or IT (`context.md` §6).

### Phase 5 — Notifications and hardening
Portal + email notifications via `lib/email/graph-client.ts` (no-ops until `MS_GRAPH_*` is set):
ticket created (to requester and IT executive), assigned (to assignee), resolved (to requester),
SLA nearing breach / breached (to IT executive), ONB/OFB assigned, completed. RLS review pass with
the tester, then `tsc` / `eslint` / `npm run build` before the `IT/dev` → `develop` PR.

---

## 6. Per-PR checklist

Same as `07-it-inventory-plan.md` §6, with the folder `supabase/it-migrations/javeria/` and file
names `javeria_it_<NNNN>_<description>.sql`.

---

## 7. Integration events

| Event | Direction | Handling |
|---|---|---|
| `it.employee_offboarded` | Emitted here | On offboarding completion; Talha's track lists the person's open assignments for the Return form |
| `it.employee_onboarded` | Emitted here (optional) | Only if another module needs it; none does yet |

---

## 8. Decisions needed before Phase 1

| # | Question | Proposed answer | Decide with |
|---|---|---|---|
| 1 | IT staff access: the existing `it.staff_roles` table (IT Executive / Site Manager) or `it.*` permission keys (Talha's plan §1.1)? | Permission keys, so IT roles are managed on `/admin/roles` like every other module; retire `staff_roles` or keep it only as a site-scoping list once scoped permissions exist | Talha, senior dev, whoever created `staff_roles` |
| 2 | Accept the ERD additions in §1.2? | Yes | Senior dev |
| 3 | SLA targets per priority (response / resolution hours) | Placeholders: Critical 1/4, High 2/8, Medium 4/24, Low 8/72, wall-clock hours | IT BA |
| 4 | Should SLAs use business hours instead of 24/7? | 24/7 for Phase 1, revisit | IT BA |
| 5 | Can employees raise a ticket on someone else's behalf ("Requested For")? | Column exists; picker deferred until a person directory exists | IT BA |
| 6 | Site Manager scope: their own site's tickets only, or everything? | Own site + assigned to them | IT BA |
| 7 | Who owns offboarding as system of record (HR or IT)? | Open in `context.md` §6 | BAs, senior dev |
| 8 | Who writes the shared foundation migration? | Whoever starts Phase 1 first (same as Talha §8 #8) | Talha |
