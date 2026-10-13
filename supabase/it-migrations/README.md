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

The senior dev decides which files to keep and in what order across both authors, then renames
them into the main sequence (`supabase/migrations/00XX_it_<description>.sql`, matching the
`00XX_it_*.sql` pattern reserved in `CODEOWNERS`). Delete the staged copy once it's been moved.

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

## Applied log

| File | Applied on | By | Notes |
|---|---|---|---|
| `talha/talha_it_0000_baseline_live_snapshot.sql` | pre-existing | — | Reference only, not runnable. The 4 tables that existed before any IT migration |
| `javaria/javaria_it_0001_tickets.sql` | 2026-10-12 | Javaria | SQL Editor. Confirmed by the `it.tickets.*` permission rows existing |
| `javaria/javaria_it_0002_onboarding_offboarding.sql` | 2026-10-12 | Javaria | SQL Editor. Confirmed by the `it.onboarding.*` permission rows existing |
