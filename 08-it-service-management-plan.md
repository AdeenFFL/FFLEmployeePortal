# IT Module (M2) — Service Management & Onboarding/Offboarding
## Implementation & Development Plan (Javaria's track)

Companion to Talha's `07-it-inventory-plan.md`. Same conventions, same branch flow, same staged
migration rules. **§1 of Talha's plan (mapping the ERD onto portal conventions) applies to both
tracks and isn't repeated here.** Where the two tracks meet, this plan mirrors his §2.1, so the
two documents stay consistent.

Written against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11), the IT BRD
(`final_doc_updated.docx` §5.1–5.3, §7.1, §7.3, §7.12–7.13, §8), and ERD v4
(`ERD_Employee_Portal_v4_detailed (1).pdf`, sections B and E).

| | |
|---|---|
| Module code / schema | `it` / `it` (shared with Talha) |
| Coarse access | `module:it` (registered on `develop` in `0021_module_it_permission.sql`) |
| This track | **IT Service Management** (tickets, tasks, SLAs, dashboard, reports) and **Onboarding / Offboarding** |
| Not this track | **Inventory** (Talha): assets, assignments, maintenance, stock, valuation. **Procurement**: see §8 #1 |
| Branch flow | `IT/javaria` + `it/talha` → `IT/dev` (IT testing) → `develop` (senior dev) |
| Migrations | Staged in `supabase/it-migrations/javaria/` (see that folder's README) |

**Decision log**
- 2026-10-12: This track's scope is IT Service Management and Onboarding/Offboarding only
  (Javaria). Procurement is **not** part of it. Talha's `07` (§2, §8 #1) currently lists
  procurement under this track and needs updating to match (§8 #1).
- 2026-10-12: Shared foundation migration is Talha's `talha_it_0001_foundation.sql` (grants,
  `it.next_number()`). This track's migrations depend on it and don't redefine any of it.
- 2026-10-12: `module:it` was registered by the senior dev on `develop`
  (`0021_module_it_permission.sql`), deliberately granted to no role. Granting it is an admin
  decision on `/admin/roles`.

---

## 1. Data model notes for this track

### 1.1 What already exists in the live `it` schema (Talha's `talha_it_0000` baseline)

| Table | This track's use |
|---|---|
| `request_types` (`applies_to` in `'Ticket' / 'Onboarding' / 'Offboarding' / 'Replacement'`, capitalised) | **Owned here.** Reused as-is; `javaria_it_0001` adds `created_by` / `updated_by`, the `updated_at` trigger and RLS. |
| `staff_roles` (`'Admin' / 'IT Staff' / 'Approver' / 'Finance'`) | **Not used.** IT access is `it.*` permissions on portal roles (both plans agree). Drop is open, see §8. |
| `asset_types`, `asset_value_types` | Talha's. |

### 1.2 ERD additions made by this track

1. **Subcategory:** `it.ticket_categories` with `parent_id` (one level), `tickets.category_id` +
   `subcategory_id`.
2. **SLA targets:** `it.sla_policies` (priority → response / resolution hours); due dates are
   computed by trigger.
3. **Ticket timeline:** `it.ticket_updates` (comment / internal work note / status change /
   assignment / priority change / escalation / system).
4. **Ticket attachments:** `it.ticket_attachments` + private `it-ticket-attachments` bucket.
5. **Escalation, first response, satisfaction, reopen count, root cause** columns on `tickets`.
6. **Extra BRD §5.3.1 fields:** requested-for, asset/system name, access required, manager
   approval required, preferred contact method, remarks, department.
7. **Statuses:** `Open → Assigned → In Progress ⇄ On Hold → Resolved → Closed`; priorities
   `Critical / High / Medium / Low`.
8. **Onboarding/Offboarding** (Phase 4): HOD IT sign-off record, employee confirmation, routing
   by location (HQ vs plant-site team), checklist completion gate — none of these are in the ERD's
   `onboarding_offboarding` / `checklist_items` and the BRD (§5.1.13, §5.2.4, §5.2.12–14) needs them.

### 1.3 Base-layer limitations this track works around

- `public.persons` is readable only by the person themself and admins → names go through
  `it.person_names(ids)` and `it.list_it_staff()` (security definer, narrowly scoped).
- `public.org_units` is admin-only → `it.list_org_units()` for the Location / Department pickers.
- `public.audit_log` accepts inserts from admins only, so `logAuditEvent()` from a non-admin IT
  user silently fails. Ticket history therefore lives in `it.ticket_updates`; onboarding /
  offboarding will keep the same kind of per-record trail (§8 #6).

---

## 2. Contracts with Talha (mirror of `07-it-inventory-plan.md` §2.1)

**This track's tables that reference Talha's**

| FK | Ordering rule |
|---|---|
| `tickets.linked_asset_id → it.assets` | **FK owned by Talha** (his Phase 3 migration, already live 2026-10-14). **This track** (`javaria_it_0004_ticket_asset_link.sql`, asset-gap review #1): no new links to soft-deleted assets, IT-side device search on the ticket workspace, device label shown to the requester. Employees can't pick their own device yet: that needs Talha's `asset_assignments` (his Phase 3) |
| `checklist_items.assignment_id → it.asset_assignments` | Onboarding/Offboarding phase starts after Talha's Phase 3 |

**Functions/components Talha provides, called from this track**

| From Talha | Used in |
|---|---|
| `assignAsset()` / `returnAsset()`, `<AssetAssignForm>` / `<AssetReturnForm>` | Onboarding "Asset Allocation" task, offboarding "Asset Return Form" |
| `listOpenAssignments(personId)` | Offboarding: what the leaver still holds |

**What Talha reads from this track:** `it.tickets where linked_asset_id = …` for his asset
"Linked tickets" tab (read-only).

**Shared surfaces:** `/it/dashboard` is owned here (Talha supplies `<InventoryKpis>`);
`/it/admin/roles` is built once, one section per track; `sidebar.tsx` / `route-permissions.ts` are
edited in separate blocks; `types/database.ts` is regenerated on `IT/dev` after merges.

**Keeping in touch:** any change to a row above is agreed with Talha first and updated in **both**
plan files in the same PR.

---

## 3. Permissions (this track)

`<module>.<resource>.<op>` style; every insert includes `label`. `module:it` is the senior dev's
(`develop` 0021); `it.manage_role_permissions` is in Talha's foundation.

| Key | Label | Gates |
|---|---|---|
| `it.tickets.read` | View IT Ticket Queue | `/it/tickets`, all tickets incl. internal notes |
| `it.tickets.update` | Work on IT Tickets | Status, notes, resolution, tasks on tickets assigned to you; appear in assignee list |
| `it.tickets.assign` | Assign & Prioritise IT Tickets | Assign any ticket, priority, escalate (IT Executive) |
| `it.tickets.close` | Close IT Tickets | Formal closure |
| `it.ticket_settings.update` | Ticket Settings | Categories, request types, SLA targets |
| `it.onboarding.create` | Raise Onboarding/Offboarding | HR raising ONB / OFB requests |
| `it.onboarding.read` | View Onboarding/Offboarding | Checklist queue |
| `it.onboarding.update` | Work Onboarding/Offboarding | Complete checklist items |
| `it.onboarding.approve` | Final Review (HOD IT) | Offboarding final review and sign-off |

Workflow rules (who may assign, close, resolve without notes, edit a closed record) are enforced
by triggers in the database, not only hidden in the UI. Same scoping limitation as Talha's §3:
`has_permission()` has no site argument yet, so "plant-site IT team only sees its plant" waits for
a scoped variant; `site_id` is stored on every row so it can be added without a backfill.

---

## 4. Screen inventory (this track)

| ID | Route | Who | Purpose |
|---|---|---|---|
| SCR-01 | `/it/my-tickets/new` | Every employee | Raise ticket (BRD §5.3.1 + attachments) → `IT-xxxxxx` |
| SCR-02 | `/it/my-tickets`, `/it/my-tickets/[id]` | Every employee | My tickets; detail, comments, confirm resolution (rating) / reopen |
| SCR-03 | `/it/tickets`, `/it/tickets/[id]` | IT staff | Queue with filters + SLA/escalation flags; workspace (triage, status, resolve, escalate, close, tasks, timeline) |
| ITSM-01 | `/it/settings/tickets` | IT admin | Categories / subcategories, request types, SLA targets |
| SCR-06 | `/it/dashboard` | IT | Ticket KPIs + `<InventoryKpis>` from Talha |
| ITSM-02 | `/it/reports` | IT mgmt | Ticket Volume (§7.12), SLA Compliance (§7.13), CSV export |
| SCR-04 | `/it/onboarding` | IT | ONB / OFB / Replacement checklists queue |
| ONB-01 | `/it/onboarding/new` | HR | Raise ONB / OFB request (BRD §5.1.1, §5.2.1 fields) |
| ONB-02 | `/it/onboarding/[id]` | IT / HOD IT | Checklist items with owner + timestamp, embedded asset forms, final review and sign-off |
| ONB-03 | `/it/my-onboarding` | New joiner | Confirm email, access, software and asset received (BRD §5.1.13) |

---

## 5. Phased delivery

Each phase is one PR from `IT/javaria` into `IT/dev`: staged migration(s), screens, Server
Actions, and a test checklist for the tester.

### Phase 1 — Ticketing core *(built and committed; not yet applied or browser-tested)*
**Migration** `javaria_it_0001_tickets.sql` (depends on `talha_it_0001_foundation.sql`):
`request_types` brought up to convention + RLS + ticket types seeded; `ticket_categories`,
`sla_policies`, `tickets`, `ticket_updates`, `ticket_tasks`, `ticket_attachments` + bucket;
triggers (clean insert state, SLA computation, workflow rules, timeline logging, first response);
`it.confirm_ticket_resolution()` / `it.reopen_ticket()`; §1.3 helper functions; RLS; ticket
permissions.
**Screens**: SCR-01, SCR-02, SCR-03.
**Shared-file edits**: "IT Tickets" nav item + "IT Service Management" group; two
route-permission entries; `next.config.ts` `serverActions.bodySizeLimit` (attachments, 8 MB total).
**Done when**: an employee can raise, track, comment, confirm or reopen; an IT executive can
assign, prioritise, escalate and close; a team member can work and resolve only tickets assigned
to them; a plain employee can't read anyone else's ticket or any internal note (proxy and RLS).

### Phase 2 — Ticket settings *(built; not yet browser-tested)*
**Screens**: ITSM-01 `/it/settings/tickets` — SLA hours per priority, request types (all four
kinds), categories / subcategories with sort order. Deactivate instead of delete (tickets keep
their FK and history). **No migration**: the write policies from `javaria_it_0001` already require
`it.ticket_settings.update`.
**Done when**: IT admin can maintain categories and request types, and change SLA hours so new
tickets pick them up.

### Phase 3 — Dashboard and reports *(built; not yet browser-tested)*
**As built**: `/it/dashboard` (KPI tiles, weekly volume, tickets by category, open-ticket age,
SLA by category, technician workload; 30 / 90 / 180-day range) and `/it/reports` (Ticket Volume,
SLA Compliance, Technician Productivity, date range, CSV export via `/it/reports/export`). Both
gated by `it.tickets.read`. Metrics computed in `lib/it/ticket-metrics.ts` from one paged ticket
fetch, under the same RLS as every screen — **no migration**. Charts are single-series, one
validated hue, with hover tooltips and table views. `<InventoryKpis>` from Talha slots in under
the KPI row when his track ships. Note: `develop`'s `0021` gates `/it/dashboard` with `module:it`;
this branch uses `it.tickets.read` (BRD §8 calls it the IT team's dashboard) — reconcile at merge.
**Original scope**: SCR-06 (open tickets, avg resolution time, SLA compliance, pending ONB/OFB tasks,
tickets by category, 90-day trend, `<InventoryKpis>`), ITSM-02 (volume and SLA reports, KPIs from
BRD §5.3.18: first response time, resolution time, SLA compliance, closure rate, ageing,
escalation rate, technician productivity).

### Phase 4 — Onboarding / Offboarding *(built ahead of Phases 2–3 at Javaria's request; not yet applied or browser-tested)*
**As built** (`javaria_it_0002_onboarding_offboarding.sql`): `it.onboarding_offboarding`,
`it.checklist_items`, `it.onboarding_updates`; default checklist seeded per type; status moves
automatically as items complete; HOD IT sign-off and employee confirmation via security-definer
functions; `it.search_employees()` picker; `it.person_names()` widened for onboarding screens.
Screens: `/it/onboarding` (queue), `/it/onboarding/new`, `/it/onboarding/[id]`,
`/it/my-onboarding` (linked from My IT Tickets when the person has one).
Design choices made while building:
- New joiners usually have no `persons` row yet, so the request stores their details and
  `person_id` is linked on the portal-account task (after the account is created on
  `/admin/users`); the portal-account task can't complete until it is.
- A leaver can't see their own offboarding record (it may be a termination); a new joiner can see
  their onboarding.
- No passwords are stored anywhere; the credential emails in BRD §5.1.10 / §5.1.12 become a
  Phase 5 notification that generates and sends, never persists.
- Asset allocation / return items record tag / serial / condition by hand until Talha's forms
  exist; `checklist_items.assignment_id` gets its FK in a later file.
- The BRD §5.1.1 "Approver" field isn't modelled; the IT Executive pick-up replaces it. Confirm
  with the IT BA.

**Original plan:**
**Migration** `javaria_it_0002_onboarding_offboarding.sql`: `onboarding_offboarding` (ONB- / OFB-
numbers via `it.next_number()`, request type, employee, Permanent / Contractual, location, due
date, status), `checklist_items` (owner, status, due, completed_at, `assignment_id →
asset_assignments`), routing by location (HQ vs plant-site team, BRD §5.2.4), checklist
completion gate before final review (§5.2.12), HOD IT sign-off (§5.2.14), employee confirmation
(§5.1.13); request types seeded (Onboarding / Offboarding / Replacement); `it.onboarding.*`
permissions. Emits `it.employee_offboarded` (direct call to Talha's `listOpenAssignments()` until
`core.integration_events` exists).
**Screens**: SCR-04, ONB-01, ONB-02, ONB-03.
**Can start before Talha's Phase 3** with the non-asset checklist items (email, access, software,
portal account); the asset allocation / return items plug in once his forms exist.
**Open dependency**: who writes employment status on offboarding, HR or IT (`context.md` §6).

### Phase 5 — Notifications and hardening *(notifications built, migration not applied; hardening pass still to do)*
**As built** (`javaria_it_0003_notifications.sql` + `lib/it/notifications.ts`): `it.notifications`
inbox written only by security-definer triggers (ticket created / assigned / resolved / closed /
reopened / escalated / commented; onboarding new / task assigned / setup ready / final review /
completed / cancelled / commented); the actor never notifies themselves except the requester's
§5.3.3 acknowledgement. Top-bar bell shows the unread count and opens `/it/notifications`.
Emails go out after each IT action via `after()` + Microsoft Graph; marked `skipped` while
`MS_GRAPH_*` isn't configured. SLA breaches: `it.notify_sla_breaches()` — needs scheduling with
pg_cron (instructions in the migration). Not done: the "nearing breach" warning, and sending
credentials to a new joiner's personal email (deliberately — no passwords are stored).
**Original scope:**
Portal + email via `lib/email/graph-client.ts` (no-ops until `MS_GRAPH_*` is set): ticket
created / assigned / resolved / SLA breach; ONB / OFB assigned, completed, credentials ready
(BRD §5.1.12). RLS review pass with the tester, then `tsc` / `eslint` / `npm run build` before the
`IT/dev` → `develop` PR.

### Phase 6 — Ticket routing, site isolation & ownership
From the routing addendum (2026-10-15), adopted with the corrections from review (2026-10-16).

**Decisions**
- Tickets are handled **per site**: a site's IT team sees only its site's tickets; HQ IT
  Executives (`it.tickets.read_all` + `it.tickets.assign`) see every site.
- Some work is **HQ-handled** whatever the requester's site (email, SAP / ERP IDs): a
  `handled_at = 'hq'` flag on request types and categories routes it to the HQ site.
- Each site has **IT managers** (assign within the site, Transfer to HQ, escalate) and
  **members** (work tickets assigned to them). Site managers can't assign HQ staff.
- Categories get **owners per site** (6.2) for auto-assignment; ownership drives routing,
  not visibility. Tickets get **one primary + helpers** (6.3). Closing writes a **frozen audit
  snapshot** (6.4).
- **Module-local `it.site_it_staff`, not `user_roles.site_id`** (decided 2026-10-16 on
  Javaria's go-ahead): User Management can't set a site on a role, and that screen is core's.
  Revisit if core adds scoped roles.
- **Routing uses `persons.site_id`**, not the ticket form's Location (the employee picks that,
  and the handling site now decides visibility). No site → HQ.
- **One HQ setting** (`it.settings.hq_site_id`) feeds both ticket routing and onboarding's
  `routing_team_for_site()`.
- **Closed stays final** (no reopen after close), so the addendum's "close, reopen, close again
  writes a second snapshot" test doesn't apply.

**Corrections to the addendum (review 2026-10-16)**
1. Rollout: the new RLS hides everything from IT staff who aren't in `site_it_staff`. Safe here
   because only the Admin role held `it.tickets.*` (live check 2026-10-16) and it gets
   `read_all`; the queue shows a banner to IT staff with no site.
2. Every security-definer function that checked `it.tickets.read` directly was rescoped:
   `list_it_staff`, the workflow trigger (site managers can triage; may only assign their site's
   staff; only HQ moves sites), and the ticket notifications (now to the handling site's
   managers, falling back to HQ Executives). Name / asset-label helpers still show names to any
   IT viewer (low sensitivity) — tighten later if needed.

**6.1 Sites & HQ routing** *(built; `javaria_it_0005_site_routing.sql`, not yet applied)*
`it.settings`, `it.site_it_staff`, `handled_at` flags (seeded: Access Request, Email Issue,
ERP Issue), `tickets.handling_site_id` + backfill, routing on insert and on re-classification,
`it.transfer_ticket_to_hq()`, site-scoped RLS on tickets / updates / tasks (attachments and
storage inherit via tickets), `it.tickets.read_all` (granted to every role holding
`it.tickets.assign`). Screens: **Sites & IT Staff** (`/it/settings/sites`: HQ site, per-site
managers / members), **Handled by HQ** toggles on Ticket Settings, queue **Site** column +
"Handled at" filter + no-site banner, workspace **Handled at** fact, site-aware **Triage**
(HQ can move sites), **Transfer to HQ** panel for site managers.
**Before testing**: set up real sites under Administration → Sites (live DB has only "HR"),
pick the HQ site, add site IT staff.

**6.2 Category owners + 6.3 Multiple assignees** *(built; one file,
`javaria_it_0006_owners_and_assignees.sql`, not yet applied)* — combined because auto-assignment
writes the primary assignee, so both were designed together rather than rewriting the same
functions twice.
- `it.category_owners` (category **or** subcategory × site, one ★ primary, must be site IT
  staff; leaving the site team drops the ownership). Editable by IT settings admins or that
  site's IT managers. Screen: **Category Owners** (`/it/settings/owners`, read-only for others).
- Auto-assignment on a new / re-routed, unassigned, Open ticket: subcategory owners at the
  handling site win, else the category's; the primary owner is assigned, other owners get an
  FYI; no owners → no assignment (site managers / HQ already notified). Auto-assignment is a
  "system" update: it does **not** stamp first response and shows as *System* on the timeline.
- `it.ticket_assignees` (primary mirrored from `tickets.assigned_to_person_id`, plus helpers).
  Helpers see the ticket and internal notes, comment, add notes and tasks; **only the primary
  changes status / resolves**; only the site manager / HQ adds or removes helpers; helpers must
  be on the site team; moving sites clears helpers. Requester comments notify primary + helpers.
- `it.ticket_task_assignees`: extra assignees on a task besides its lead.
- Screens: workspace **Helpers** panel, **Routed to** fact, ★ owners first in the assignee list,
  "Also assign to" on tasks; queue **Assign / View** row actions and "Ali (+1)". The Assign
  action jumps to the workspace's Triage panel rather than a separate dialog.

**6.4 Closure audit** *(built; `javaria_it_0007_closure_audit.sql`, not yet applied)* —
`it.ticket_closure_audit`: one frozen snapshot per ticket when it's Closed (ticket row, site,
category names, assignees, tasks + assignees, attachment / timeline counts, SLA met). Append-only,
readable with `it.tickets.read_all`; already-closed tickets are backfilled. Workspace shows a
**Closure record** line to HQ.

**IT Roles & Permissions** *(built; `javaria_it_0008_it_roles.sql`, not yet applied)* — the
IT module's own access screen at `/it/admin/roles` (gated by `it.manage_role_permissions`, the
shared screen from Talha's plan §2.1). Shows and changes **only `module = 'it'` permissions**,
via `it.set_role_it_permission()` (security definer — `public.role_permissions` is writable only
by full admins, so this lets an IT admin manage IT access without `core.full_access`; refuses
non-IT permissions, won't revoke the last holder of `it.manage_role_permissions`, writes
`public.audit_log`). `it.it_roles` tags IT department roles (listed first; other roles shown
separately because Employee / HR still need some IT permissions). Seeded roles: **IT Admin**
(all IT permissions), **IT Executive (HQ)**, **HOD IT**, **IT Site Manager**, **IT Team
Member**. Putting people into roles stays on User Management (core).

**Open (IT BA / senior dev)**: full list of HQ-handled work (VPN, domain accounts, licences?);
can helpers change status or only comment; do HQ-handled requests need site-manager approval
first; mirror closures into `public.audit_log` (§8 #6).

---

## 6. Per-PR checklist

Same as `07-it-inventory-plan.md` §6, with the folder `supabase/it-migrations/javaria/` and file
names `javaria_it_<NNNN>_<description>.sql`.

---

## 7. Integration events

| Event | Direction | Handling |
|---|---|---|
| `it.employee_offboarded` | Emitted here | On offboarding completion; Talha's `listOpenAssignments()` feeds the Return form |
| `it.employee_onboarded` | Emitted here (optional) | Only if another module needs it; none does yet |

---

## 8. Decisions

| # | Question | Status |
|---|---|---|
| 1 | Who owns Procurement (ERD section D: vendors, products, demands, receiving, invoices, payments)? | **Taken on by Javaria (2026-10-21)** — planned separately in `09-it-procurement-plan.md`, which mirrors Talha's `07` §2.1 contracts (vendors + products first, to unblock his Phases 5 and 7) |
| 2 | IT staff access: `it.staff_roles` or `it.*` permissions? | **Permissions** (both plans). Drop of `staff_roles` still open, Talha §8 #4a, senior dev |
| 3 | `module:it` grants | **Decided by senior dev** (`develop` 0021): registered, granted to no role. Talha's foundation also inserts `module:it` and grants it to Employee/Admin, which contradicts that; Talha to drop that part |
| 4 | SLA targets per priority (response / resolution hours) | Open: placeholders Critical 1/4, High 2/8, Medium 4/24, Low 8/72 (wall-clock); IT BA |
| 5 | Business-hours SLAs instead of 24/7? | Open: 24/7 for Phase 1; IT BA |
| 6 | Let non-admin modules write `public.audit_log`? | Open: senior dev. Until then each IT record keeps its own trail |
| 7 | "Requested For" on tickets (raise on someone's behalf)? | Open: column exists, picker deferred until a person directory exists; IT BA |
| 8 | Who owns offboarding as system of record (HR or IT)? | Open: `context.md` §6; BAs, senior dev |
