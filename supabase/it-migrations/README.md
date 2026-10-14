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
| `talha/talha_it_0007_asset_tag_manual.sql` | 2026-10-14 | Talha | Decision 5: asset tags entered manually (drops the default, adds not-blank check and case-insensitive unique index). Not yet in the main sequence |
