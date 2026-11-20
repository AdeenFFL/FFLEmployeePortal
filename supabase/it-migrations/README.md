# IT Module (M2) — staged migrations

Migrations for the `it` schema are **staged here, per developer, until they're merged** — not in
`supabase/migrations/`. The Supabase CLI only reads top-level files in `supabase/migrations/`, so
nothing in this folder gets picked up by `supabase db push` by accident.

```
supabase/it-migrations/
  talha/     ← Inventory, Assets, Procurement (it/talha)
  javaria/   ← IT Service Management (tickets), Onboarding/Offboarding (IT/javaria)
```

## File naming

`<author>_it_<NNNN>_<short_description>.sql`, numbered per author, e.g.
`talha_it_0001_foundation.sql`. The number orders one author's files. It is **not** the final
portal-wide sequence number.

## At merge time (it/dev → develop)

The senior dev decides which files to keep and in what order across both authors, then copies
them into the main sequence (`supabase/migrations/00XX_it_<description>.sql`, matching the
`00XX_it_*.sql` pattern reserved in `CODEOWNERS`). The staged copy stays here as the historical
record of each author's own branch — see "Reconciled into the main sequence" below for how
0024-0029 map back to these files.

## Required header in every file

```sql
-- Author:      Talha
-- Branch:      it/talha
-- Feature:     <phase / feature from 07-it-inventory-plan.md>
-- Depends on:  <other staged files this one assumes have run, incl. the other author's>
-- Applied to live DB: NO | YES (YYYY-MM-DD, by whom)
```

**Keep `Applied to live DB` accurate.** There is one shared Supabase project for every
environment (`context.md` §4, 2026-09-16). Running a staged file against it changes the database
for everyone, including the HR module and the other IT developer, even though the code is still
on a feature branch. Snapshot or back up before anything that drops or alters a column.

## Reconciled into the main sequence — 2026-10-13

All 6 of the staged files below were verified **directly against the live database**
(information_schema, pg_proc, pg_trigger, permissions/role_permissions — not just their own
"Applied to live DB" headers, several of which had drifted from reality) and found fully
applied. They've been replicated into `supabase/migrations/` in dependency order — nothing in
them was re-run, this only gave the already-live state a linear, portal-wide migration history.

**Kept here too, by explicit request** — the per-developer staged copy stays in place as the
original historical record of each author's own work, alongside (not instead of) the
replicated main-sequence file:

| Staged file | Replicated as |
|---|---|
| `talha/talha_it_0001_foundation.sql` | `supabase/migrations/0024_it_foundation.sql` |
| `javaria/javaria_it_0001_tickets.sql` | `supabase/migrations/0025_it_tickets.sql` |
| `talha/talha_it_0002_inventory_settings.sql` | `supabase/migrations/0026_it_inventory_settings.sql` |
| `javaria/javaria_it_0002_onboarding_offboarding.sql` | `supabase/migrations/0027_it_onboarding_offboarding.sql` |
| `talha/talha_it_0003_assets.sql` | `supabase/migrations/0028_it_assets.sql` |
| `javaria/javaria_it_0003_notifications.sql` | `supabase/migrations/0029_it_notifications.sql` |

The two copies are expected to diverge over time in header/comment text only (the main-sequence
file's header is rewritten to drop the staging-specific Author/Branch/Applied-to-live-DB lines);
the SQL body should stay identical unless someone deliberately edits one. The main-sequence file
under `supabase/migrations/` is the one that's authoritative and actually gets run by
`supabase db push` on a fresh environment — this folder's copy is historical reference only.

`talha/talha_it_0000_baseline_live_snapshot.sql` was never replicated — it's explicitly
reference-only (every statement commented out, "DO NOT RUN"), not a migration.

**One real conflict found and resolved during reconciliation:** `talha_it_0001_foundation.sql`'s
`module:it` permission insert and `0021_module_it_permission.sql` (already in the main sequence,
predating this reconciliation) both insert the `module:it` key with different descriptions.
`on conflict (key) do nothing` made this safe either way — no error, no corruption — but since
0021 runs first in the main sequence, its shorter description is the one that's actually live.
0024 keeps Talha's insert verbatim (for fidelity to what her branch contains) with a comment
explaining it's a confirmed no-op.

**Untracked drift found, not fixed here (flagged for the team, not acted on unilaterally):**
- `it.staff_roles` + `it.has_role(variadic roles text[])` — pre-date both IT tracks, hardcode
  role names ('Admin', 'IT Staff', 'Approver', 'Finance') in a check constraint (exactly the
  anti-pattern 0019_direct_role_permissions.sql removed from the rest of the app), and are
  confirmed unused by any of the 6 reconciled files (everything uses `has_permission()` instead)
  and confirmed empty. Talha's own `talha_it_0000` notes flagged this as "not owned by either IT
  track yet... drop once confirmed empty and unused" — that condition is now met, but dropping
  live schema objects outside this reconciliation's explicit scope wasn't done without asking.
- A duplicate `it.set_updated_at()` function and a duplicate `trg_request_types_updated_at`
  trigger on `it.request_types` exist alongside the tracked `public.set_updated_at()` version —
  redundant (both just set `updated_at = now()`) but harmless. Not sourced from any of the 6
  files; likely an early experiment before the convention settled. Candidate for a small cleanup
  migration later.

## Reconciled into the main sequence — 2026-10-22 (batch 2)

All 11 remaining staged files below (talha 0004–0009, javaria 0004–0008) were verified
**directly against the live database** the same way as the first batch — several of javaria's
own "Applied to live DB: NO" headers had drifted from reality; all 11 were confirmed fully live
via `information_schema`/`pg_proc` before anything was replicated. Nothing in them was re-run.

Numbering had to interleave the two authors' files by actual dependency, not by author: Javaria's
`0004_ticket_asset_link.sql` depends on the FK that Talha's `0004_asset_assignments.sql` owns, so
Talha's file comes first in the main sequence even though both are each author's own "0004". The
new ticket/onboarding IT-module-revision work done the same day (search-my-assets-for-ticket,
onboarding asset allocation) was renumbered up to 0041–0042 so it sorts *after* this batch — it
reads from tables (`it.asset_assignments`) this batch creates, so a fresh environment must run
these first.

| Staged file | Replicated as |
|---|---|
| `talha/talha_it_0004_asset_assignments.sql` | `supabase/migrations/0030_it_asset_assignments.sql` |
| `javaria/javaria_it_0004_ticket_asset_link.sql` | `supabase/migrations/0031_it_ticket_asset_link.sql` |
| `talha/talha_it_0005_asset_maintenance.sql` | `supabase/migrations/0032_it_asset_maintenance.sql` |
| `talha/talha_it_0006_asset_values.sql` | `supabase/migrations/0033_it_asset_values.sql` |
| `talha/talha_it_0007_asset_tag_manual.sql` | `supabase/migrations/0034_it_asset_tag_manual.sql` |
| `talha/talha_it_0008_people_lookup.sql` | `supabase/migrations/0035_it_people_lookup.sql` |
| `talha/talha_it_0009_inventory_role_grants.sql` | `supabase/migrations/0036_it_inventory_role_grants.sql` |
| `javaria/javaria_it_0005_site_routing.sql` | `supabase/migrations/0037_it_site_routing.sql` |
| `javaria/javaria_it_0006_owners_and_assignees.sql` | `supabase/migrations/0038_it_owners_and_assignees.sql` |
| `javaria/javaria_it_0007_closure_audit.sql` | `supabase/migrations/0039_it_closure_audit.sql` |
| `javaria/javaria_it_0008_it_roles.sql` | `supabase/migrations/0040_it_roles.sql` |

Same dual-copy policy as batch 1: the staged originals stay in `talha/`/`javaria/` as the
historical record of each author's own branch; the `supabase/migrations/` file is the
authoritative one `supabase db push` actually runs on a fresh environment. Bodies are verified
byte-for-byte identical to their staged source (diffed programmatically after generation); only
the header comment block (Author/Branch/Depends on/Applied-to-live-DB) was replaced with a short
replicated-from note, same as batch 1.

**No new conflicts found.** Every INSERT in this batch is conflict-safe (`on conflict ... do
nothing` or an explicit `not exists`/`where` guard), so re-running the full sequence on a fresh
environment is safe.

## Reconciled into the main sequence — 2026-10-30 (batch 3)

All 10 remaining staged `javaria/` files (0009–0018, the whole Procurement track plus the
employee-lookup picker) were already headered `Applied to live DB: YES` — unlike the earlier two
batches, nothing had drifted, so no live-database re-verification was needed before replicating.
Talha has nothing pending (her 0000–0009 were all folded in by batch 2), so this batch is a
straight linear run of Javaria's own numbering — no cross-author interleaving was required.

| Staged file | Replicated as |
|---|---|
| `javaria/javaria_it_0009_procurement_masters.sql` | `supabase/migrations/0052_it_procurement_masters.sql` |
| `javaria/javaria_it_0010_demands.sql` | `supabase/migrations/0053_it_demands.sql` |
| `javaria/javaria_it_0011_demand_approvals.sql` | `supabase/migrations/0054_it_demand_approvals.sql` |
| `javaria/javaria_it_0012_receiving_documents.sql` | `supabase/migrations/0055_it_receiving_documents.sql` |
| `javaria/javaria_it_0013_procurement_improvements.sql` | `supabase/migrations/0056_it_procurement_improvements.sql` |
| `javaria/javaria_it_0014_invoices.sql` | `supabase/migrations/0057_it_invoices.sql` |
| `javaria/javaria_it_0015_payments.sql` | `supabase/migrations/0058_it_payments.sql` |
| `javaria/javaria_it_0016_procurement_hardening.sql` | `supabase/migrations/0059_it_procurement_hardening.sql` |
| `javaria/javaria_it_0017_procurement_brd_alignment.sql` | `supabase/migrations/0060_it_procurement_brd_alignment.sql` |
| `javaria/javaria_it_0018_employee_lookup.sql` | `supabase/migrations/0061_it_employee_lookup.sql` |

Same dual-copy policy as batches 1 and 2: the staged originals stay in `javaria/` as the
historical record of that branch; the `supabase/migrations/` files are the authoritative ones
`supabase db push` actually runs on a fresh environment. Bodies are byte-for-byte identical to
their staged source (diffed programmatically after generation); only the header comment block
(Author/Branch/Feature/Depends on/Applied-to-live-DB) was replaced with a short replicated-from
note, same as prior batches.

## Reconciled into the main sequence — 2026-11-05 (batch 4)

The 2 remaining staged `javaria/` files (0019-0020, both already headered `Applied to live DB:
YES` with a specific date and verifier — no live re-verification needed) were replicated the same
way as batch 3, continuing straight on from `0066_it_employee_lookup.sql` (the renumbered end of
batch 3) rather than reusing `0052`/`0053`, which this reconciliation now also knows are taken by
IT/adeen's own sequence.

| Staged file | Replicated as |
|---|---|
| `javaria/javaria_it_0019_route_waiting_on_new_approver.sql` | `supabase/migrations/0067_it_route_waiting_on_new_approver.sql` |
| `javaria/javaria_it_0020_demands_without_hq_site.sql` | `supabase/migrations/0068_it_demands_without_hq_site.sql` |

Same dual-copy policy as earlier batches: the staged originals stay in `javaria/`; the
`supabase/migrations/` files are the authoritative ones `supabase db push` actually runs on a
fresh environment. Bodies are byte-for-byte identical to their staged source; only the header
comment block was replaced with a short replicated-from note.

## Reconciled into the main sequence — 2026-11-20 (batch 5)

Three branches had drifted apart since the last reconciliation: `develop` (this project's own
work), `IT/dev` / `IT/javaria` (now the same commit — Javaria's track), and `it/talha`. All three
shared the same base (`c4b4434`, batch 4's own commit), so this was a clean three-way merge, not a
tangle of unrelated history — done on a dedicated integration branch, nothing pushed to `develop`
until reviewed.

Code came first (see that merge's own commit messages for the conflict resolution — in short,
Talha's new HR Clearance system retires the self-offboarding screens this project built on
`hr.offboarding.*`, kept as the deliberate replacement rather than run in parallel). This batch is
the migration half: 21 staged files across both branches, none of which touched
`supabase/migrations/` directly (both authors followed the staging convention), reconciled into
the main sequence as `0069`–`0089`, continuing straight on from `0068`.

Ordering kept each author's own staged numbering together rather than interleaving by date, same
as batch 3 (no cross-author dependency needed it): Javaria's `0021`–`0028` first (`0069`–`0076`),
then Talha's `talha_it_0010`–`0012` (`0077`–`0079`), then Talha's whole new `talha_hr_0001`–`0010`
Clearance track (`0080`–`0089`), which is self-contained and depends on neither of the others.

**`javaria_it_0023_repairs_and_guides.sql`** is a special case: an earlier draft of "Inventory and
Procurement working as one" that was itself run live, then immediately superseded in place by
`javaria_it_0024` once the design was agreed. Both are replicated, in order (`0071` then `0072`),
reproducing the exact two-step path the live database actually went through — `0071` is not safe
to run in isolation against a database that already has `0072`'s functions.

**`javaria_it_0026_set_person_role.sql` and `javaria_it_0027_repair_flow_fixes.sql`** are both
headered "Applied to live DB: NO", but both headers are stale — confirmed live 2026-11-20 by a
read-only check (`public.set_person_role`/`public.notify_role_access_changed` exist;
`trg_invoices_set_repair_cost` already fires on delete and `it.demands_guard_links` already blocks
a quantity change). So every file in this batch is already live, same as every batch since batch
3 — nothing in this batch needs an actual `supabase db push`, only `migration repair`.

| Staged file | Replicated as |
|---|---|
| `javaria/javaria_it_0021_register_assets_from_receipt.sql` | `supabase/migrations/0069_it_register_assets_from_receipt.sql` |
| `javaria/javaria_it_0022_consumable_stock.sql` | `supabase/migrations/0070_it_consumable_stock.sql` |
| `javaria/javaria_it_0023_repairs_and_guides.sql` | `supabase/migrations/0071_it_repairs_and_guides.sql` |
| `javaria/javaria_it_0024_repairs_in_procurement.sql` | `supabase/migrations/0072_it_repairs_in_procurement.sql` |
| `javaria/javaria_it_0025_beyond_repair.sql` | `supabase/migrations/0073_it_beyond_repair.sql` |
| `javaria/javaria_it_0026_set_person_role.sql` | `supabase/migrations/0074_it_set_person_role.sql` |
| `javaria/javaria_it_0027_repair_flow_fixes.sql` | `supabase/migrations/0075_it_repair_flow_fixes.sql` |
| `javaria/javaria_it_0028_onboarding_task_flow.sql` | `supabase/migrations/0076_it_onboarding_task_flow.sql` |
| `talha/talha_it_0010_valuation_functions.sql` | `supabase/migrations/0077_it_valuation_functions.sql` |
| `talha/talha_it_0011_person_delete_rules.sql` | `supabase/migrations/0078_it_person_delete_rules.sql` |
| `talha/talha_it_0012_keep_assignment_history.sql` | `supabase/migrations/0079_it_keep_assignment_history.sql` |
| `talha/talha_hr_0001_clearance_system.sql` | `supabase/migrations/0080_hr_clearance_system.sql` |
| `talha/talha_hr_0002_clearance_permissions.sql` | `supabase/migrations/0081_hr_clearance_permissions.sql` |
| `talha/talha_hr_0003_clearance_fixes.sql` | `supabase/migrations/0082_hr_clearance_fixes.sql` |
| `talha/talha_hr_0004_clearance_signer_lookups.sql` | `supabase/migrations/0083_hr_clearance_signer_lookups.sql` |
| `talha/talha_hr_0005_hrbp_inbox_lookups.sql` | `supabase/migrations/0084_hr_hrbp_inbox_lookups.sql` |
| `talha/talha_hr_0006_hr_roles_can_sign.sql` | `supabase/migrations/0085_hr_roles_can_sign.sql` |
| `talha/talha_hr_0007_clearance_hr_details.sql` | `supabase/migrations/0086_hr_clearance_hr_details.sql` |
| `talha/talha_hr_0008_skip_manager_assets.sql` | `supabase/migrations/0087_hr_skip_manager_assets.sql` |
| `talha/talha_hr_0009_sign_for_all_roles.sql` | `supabase/migrations/0088_hr_sign_for_all_roles.sql` |
| `talha/talha_hr_0010_clearance_onboarding_defaults.sql` | `supabase/migrations/0089_hr_clearance_onboarding_defaults.sql` |

Same dual-copy policy as every batch: the staged originals stay in `javaria/`/`talha/` as each
author's own historical record; the `supabase/migrations/` files are the authoritative ones
`supabase db push` actually runs on a fresh environment. Every SQL body was verified
programmatically byte-identical to its staged source; only the header comment block was replaced
with a short replicated-from note.

## Reconciled into the main sequence — 2026-11-20 (batch 6)

One file, landed right after batch 5: `javaria_it_0029_task_notification_link.sql` (the "Task
assigned" notification now opens the new per-task page, `/it/onboarding/<request>/tasks/<task>`,
instead of the whole request). Unlike every file in batch 5, this one's "Applied to live DB: NO"
header is **not** stale — genuinely pending. Replicated as `0090_it_task_notification_link.sql`,
continuing on from `0089`.

| Staged file | Replicated as |
|---|---|
| `javaria/javaria_it_0029_task_notification_link.sql` | `supabase/migrations/0090_it_task_notification_link.sql` (not yet applied) |

## Applied log

| File | Applied on | By | Notes |
|---|---|---|---|
| `talha/talha_it_0000_baseline_live_snapshot.sql` | pre-existing | — | Reference only, not runnable. The 4 tables that existed before any IT migration |
| `talha/talha_it_0001_foundation.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0024_it_foundation.sql` |
| `javaria/javaria_it_0001_tickets.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0025_it_tickets.sql`. Javaria's header says run 2026-10-12 |
| `talha/talha_it_0002_inventory_settings.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0026_it_inventory_settings.sql` |
| `javaria/javaria_it_0002_onboarding_offboarding.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0027_it_onboarding_offboarding.sql`. Javaria's header says run 2026-10-12 |
| `talha/talha_it_0003_assets.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0028_it_assets.sql` |
| `javaria/javaria_it_0003_notifications.sql` | 2026-10-13 (verified live) | — | Confirmed applied during reconciliation; replicated as `0029_it_notifications.sql` |
| `talha/talha_it_0004_asset_assignments.sql` | 2026-10-14 | Talha | Phase 3: asset assignment, return and My Assets. Not yet in the main sequence |
| `talha/talha_it_0005_asset_maintenance.sql` | 2026-10-14 | Talha | Phase 4: repair and maintenance log. Not yet in the main sequence |
| `talha/talha_it_0006_asset_values.sql` | 2026-10-14 | Talha | Phase 6: asset valuation and depreciation. Not yet in the main sequence |
| `javaria/javaria_it_0004_ticket_asset_link.sql` | 2026-10-14 | Javaria | Ticket ↔ asset: soft-delete guard, device search and label helpers. Depends on `talha_it_0004` (owns the `tickets_linked_asset_id_fkey` FK). Not yet in the main sequence |
| `talha/talha_it_0007_asset_tag_manual.sql` | 2026-10-14 | Talha | Decision 5: asset tags entered manually (drops the default, adds not-blank check and case-insensitive unique index). Not yet in the main sequence |
| `talha/talha_it_0008_people_lookup.sql` | 2026-10-15 | Talha | Phase 3: people lookup for inventory staff (`it.search_people`, `it.asset_person_names`); Javaria's `person_names()` untouched. Not yet in the main sequence |
| `javaria/javaria_it_0005_site_routing.sql` | 2026-10-16 | Javaria | Phase 6.1: ticket site isolation + HQ routing (`it.settings`, `it.site_it_staff`, `handling_site_id`, site-scoped RLS, Transfer to HQ, new `it.tickets.read_all` → Admin). **Replaces** several functions/policies from `javaria_it_0001`/`0003` (listed in its header). Not yet in the main sequence |
| `talha/talha_it_0009_inventory_role_grants.sql` | 2026-10-19 | Talha | Inventory permissions for HOD IT, IT Admin, IT Executive (HQ), IT Site Manager, IT Team Member: the inventory half of the bundles. The roles and their ticket/onboarding bundles come from javaria_it_0008 (main-sequence 0040). Admin and IT untouched; IT Admin's inventory grants overlap 0008's and are skipped as duplicates. |
| `javaria/javaria_it_0009_procurement_masters.sql` | 2026-10-23 (verified live) | Javaria | Procurement Phase 1: vendors, products, procurement settings. Replicated as `0057_it_procurement_masters.sql` |
| `javaria/javaria_it_0010_demands.sql` | 2026-10-23 (verified live) | Javaria | Procurement Phase 2: demands, categorisation, consumable path. Replicated as `0058_it_demands.sql` |
| `javaria/javaria_it_0011_demand_approvals.sql` | 2026-10-28 (verified live) | Javaria | Procurement Phase 3: department-head approval. Replicated as `0059_it_demand_approvals.sql` |
| `javaria/javaria_it_0012_receiving_documents.sql` | 2026-10-28 (verified live) | Javaria | Procurement Phase 4: vendor assignment, receiving, documents. Replicated as `0060_it_receiving_documents.sql` |
| `javaria/javaria_it_0013_procurement_improvements.sql` | 2026-10-28 (verified live) | Javaria | Improvements to Procurement Phases 1-4 ahead of invoices. Replicated as `0061_it_procurement_improvements.sql` |
| `javaria/javaria_it_0014_invoices.sql` | 2026-10-28 (verified live) | Javaria | Procurement Phase 5: invoices. Replicated as `0062_it_invoices.sql` |
| `javaria/javaria_it_0015_payments.sql` | 2026-10-28 (verified live) | Javaria | Procurement Phase 6: Finance processing and payments. Replicated as `0063_it_payments.sql` |
| `javaria/javaria_it_0016_procurement_hardening.sql` | 2026-10-30 (verified live) | Javaria | Procurement Phase 8: RLS hardening. Replicated as `0064_it_procurement_hardening.sql` |
| `javaria/javaria_it_0017_procurement_brd_alignment.sql` | 2026-10-30 (verified live) | Javaria | Procurement BRD alignment review. Replicated as `0065_it_procurement_brd_alignment.sql` |
| `javaria/javaria_it_0018_employee_lookup.sql` | 2026-10-30 (verified live) | Javaria | Employee lookup for the offboarding/replacement picker. Replicated as `0066_it_employee_lookup.sql` |
| — | 2026-11-04 | Adeen | Renumbered 0052–0061 → 0057–0066: IT/adeen's own `0052_it_onboarding_site_scoping.sql`…`0056_hr_onboarding_replacement_permissions.sql` sequence collided with this one at merge time (both branches started numbering fresh at 0052 off an older common ancestor). Adeen's files were already applied live under 0052–0054 by the time of the merge, so Javaria's sequence was shifted instead, preserving its internal order. |
| — | 2026-11-05 | Adeen | **Resolved** — there is only ever one Supabase project (confirmed by Javaria), so the open question above was never about *which* project. `supabase migration list` against it shows 0001–0055 recorded applied and 0056–0068 all unrecorded, which is the real explanation: everything from `0057_it_procurement_masters.sql` onward (Javaria's whole procurement + employee-lookup + approver-routing sequence) was run by hand through the Supabase SQL Editor rather than `supabase db push`, so it's live but was never written into `supabase_migrations.schema_migrations`, the CLI's own tracking table — consistent with every one of those files' own "Applied to live DB: YES" header. `0056_hr_onboarding_replacement_permissions.sql` is the one real exception: it is genuinely unapplied. **Before the next `supabase db push`:** repair the CLI's tracking table for 0057–0068 (`supabase migration repair --status applied 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068`) so it stops trying to re-create objects that already exist, *then* push — which at that point only actually runs 0056. |
| `javaria/javaria_it_0019_route_waiting_on_new_approver.sql` | 2026-11-02 (confirmed live by read-only check) | Javaria | Adding a department approver (or flipping their approve-demands/approve-invoices switch on) routes that department's waiting Categorized demands / Verified invoices straight to Pending Approval, instead of needing a manual "Send for approval" per item. Replicated as `0067_it_route_waiting_on_new_approver.sql` |
| `javaria/javaria_it_0020_demands_without_hq_site.sql` | 2026-11-03 (applied by Javaria via Supabase SQL Editor) | Javaria | Fixes `it.demands_before_insert`, broken by 0053's removal of `it.hq_site_id()`/`it.settings` (HQ-site routing removal) — the no-site fallback is now the requester's own site. Replicated as `0068_it_demands_without_hq_site.sql` |
| `javaria/javaria_it_0021_register_assets_from_receipt.sql` | 2026-11-06 (applied by Javaria via Supabase SQL Editor) | Javaria | Receiving → assets: register each accepted unit of a fixed-asset delivery as an asset, with its first valuation. Replicated as `0069_it_register_assets_from_receipt.sql` |
| `javaria/javaria_it_0022_consumable_stock.sql` | 2026-11-06 (applied by Javaria via Supabase SQL Editor) | Javaria | Consumable stock ledger, on-hand view, record_stock_movement(); receiving a consumable adds stock automatically. Replicated as `0070_it_consumable_stock.sql` |
| `javaria/javaria_it_0023_repairs_and_guides.sql` | 2026-11-06 (first draft, superseded in place by 0024) | Javaria | Inventory and Procurement working as one, first draft. Replicated as `0071_it_repairs_and_guides.sql`, immediately followed by its own replicated 0024 — do not run in isolation against an already-current database. |
| `javaria/javaria_it_0024_repairs_in_procurement.sql` | 2026-11-10 (applied by Javaria via Supabase SQL Editor) | Javaria | Brings 0023's first draft to the agreed repairs-as-demands design. Replicated as `0072_it_repairs_in_procurement.sql` |
| `javaria/javaria_it_0025_beyond_repair.sql` | 2026-11-16 (confirmed live: 9-argument it.record_device_back installed) | Javaria | Beyond repair at Device back: retire, notify the holder, keep the ticket open for Replace device. Replicated as `0073_it_beyond_repair.sql` |
| `javaria/javaria_it_0026_set_person_role.sql` | 2026-11-20 (confirmed live by read-only check; own header said NO) | Javaria | Role changes stick and notify the person. Replicated as `0074_it_set_person_role.sql` |
| `javaria/javaria_it_0027_repair_flow_fixes.sql` | 2026-11-20 (confirmed live by read-only check; own header said NO) | Javaria | Three repair-flow fixes (quantity fixed at 1, bill counted once, replace once). Replicated as `0075_it_repair_flow_fixes.sql` |
| `javaria/javaria_it_0028_onboarding_task_flow.sql` | 2026-11-19 (first version applied; this is the safe-to-rerun revision) | Javaria | Checklist tasks always have an owner (primary task-type owner, else the request's IT Executive); tasks follow a later-assigned IT Executive. Replicated as `0076_it_onboarding_task_flow.sql` |
| `talha/talha_it_0010_valuation_functions.sql` | 2026-11-13 | Talha | Phase 6 valuation: it.compute_depreciation and it.record_asset_valuation (straight line, completed months). Replicated as `0077_it_valuation_functions.sql` |
| `talha/talha_it_0011_person_delete_rules.sql` | 2026-11-19 | Talha | Admin > Users can delete a person who only touched inventory records (assigned_by/returned_to go ON DELETE SET NULL). Replicated as `0078_it_person_delete_rules.sql` |
| `talha/talha_it_0012_keep_assignment_history.sql` | 2026-11-19 | Talha | Asset assignment history keeps the holder/assigner/returned-to name after the person is deleted (holder_name, holder_employee_code, assigned_by_name, returned_to_name columns). Replicated as `0079_it_keep_assignment_history.sql` |
| `talha/talha_hr_0001_clearance_system.sql` | 2026-11-12 | Talha | Offboarding clearance system, HR module: tables, functions, form lines. Replicated as `0080_hr_clearance_system.sql` |
| `talha/talha_hr_0002_clearance_permissions.sql` | 2026-11-12 | Talha | Offboarding clearance permissions, roles HRBP and Clearance Signer. Replicated as `0081_hr_clearance_permissions.sql` |
| `talha/talha_hr_0003_clearance_fixes.sql` | 2026-11-13 | Talha | Clearance review fixes: page-one tick reflects answers, own-clearance block, line consistency trigger, date limits. Replicated as `0082_hr_clearance_fixes.sql` |
| `talha/talha_hr_0004_clearance_signer_lookups.sql` | 2026-11-13 | Talha | Clearance signers screen: 6 lookup and management functions (list units, list signers, search people, add, remove, set primary). Replicated as `0083_hr_clearance_signer_lookups.sql` |
| `talha/talha_hr_0005_hrbp_inbox_lookups.sql` | 2026-11-16 | Talha | HRBP inbox lookups: hr.clearance_search_employees and hr.refresh_clearance_case_org. Replicated as `0084_hr_hrbp_inbox_lookups.sql` |
| `talha/talha_hr_0006_hr_roles_can_sign.sql` | 2026-11-17 | Talha | Lets the HR and HRBP roles open the signer inbox (hr.clearance.sign). Replicated as `0085_hr_roles_can_sign.sql` |
| `talha/talha_hr_0007_clearance_hr_details.sql` | 2026-11-18 | Talha | Clearance page one: hr.clearance_hr_details and hr.save_clearance_details (details the HR signer fills in). Replicated as `0086_hr_clearance_hr_details.sql` |
| `talha/talha_hr_0008_skip_manager_assets.sql` | 2026-11-19 | Talha | Clearance: skip a part per request, line manager confirms data received, IT assets returned from the clearance form; replaces 4 functions. Replicated as `0087_hr_skip_manager_assets.sql` |
| `talha/talha_hr_0009_sign_for_all_roles.sql` | 2026-11-19 | Talha | hr.clearance.sign also granted to Employee and IT roles, so a signer keeps their normal role. Replicated as `0088_hr_sign_for_all_roles.sql` |
| `talha/talha_hr_0010_clearance_onboarding_defaults.sql` | 2026-11-19 | Talha | Prefills clearance from the employee's own onboarding request where one exists. Replicated as `0089_hr_clearance_onboarding_defaults.sql` |
| — | 2026-11-20 | Adeen | Reconciled `IT/dev` (Javaria, `javaria_it_0021`–`0028`) and `it/talha` (Talha, `talha_it_0010`–`0012` and the new `talha_hr_0001`–`0010` Clearance system) into one integration branch alongside `develop`, merging code first (conflict: Talha's Clearance system retires the self-offboarding screens built on `hr.offboarding.*` — resolved in the user's favor of Clearance as the deliberate replacement) and then these 21 staged files into the main sequence as `0069`–`0089`, continuing straight on from `0068`. `javaria_it_0026`/`0027` were initially flagged as the only two not already live (their own headers say "Applied to live DB: NO"), but a same-day read-only check against the live DB (`pg_proc`/`pg_trigger`) confirmed both are live too — every file in this batch needs only `migration repair`, not a real `db push`. |
| `javaria/javaria_it_0029_task_notification_link.sql` | **Not applied** | Javaria | "Task assigned" notification now opens the task's own page (`/it/onboarding/<request>/tasks/<task>`) instead of the whole request. Replicated as `0090_it_task_notification_link.sql` — genuinely pending, not yet pushed. |
