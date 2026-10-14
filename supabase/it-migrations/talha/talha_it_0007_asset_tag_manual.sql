-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Decision 5 (asset tag) - tags are now typed in by hand, not auto-generated
-- Depends on:  talha_it_0003_assets.sql (it.assets) - already applied.
-- Applied to live DB: YES (2026-10-14, by Talha)

-- Safe to undo:
--   alter table it.assets alter column asset_tag set default it.next_number('AST');
--   alter table it.assets drop constraint assets_asset_tag_not_blank;
--   drop index it.uq_assets_asset_tag_ci;

begin;

-- 1. The database no longer invents a tag. The person must type one.
--    (asset_tag stays NOT NULL and UNIQUE, so a tag is still required.)
alter table it.assets
  alter column asset_tag drop default;

-- 2. A tag cannot be empty or just spaces.
alter table it.assets
  add constraint assets_asset_tag_not_blank
  check (btrim(asset_tag) <> '');

-- 3. Typed tags: "FFL-LAP-001" and "ffl-lap-001 " must count as the SAME tag.
--    (The existing unique rule alone would treat them as different.)
create unique index uq_assets_asset_tag_ci
  on it.assets (lower(btrim(asset_tag)));

commit;
