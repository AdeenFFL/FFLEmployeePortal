-- Author:      Talha
-- Branch:      it/talha
-- Feature:     IT Inventory - let Admin > Users delete a person who only TOUCHED inventory records
-- Depends on:  talha_it_0002 .. 0006 (live), supabase/migrations/0022_cascade_person_deletes.sql
-- Applied to live DB: YES (2026-11-19, by Talha; check query showed SET NULL / person_id NO ACTION)
--
-- PROBLEM
--   Admin > Users "Permanently delete user" deletes public.persons and relies on every foreign key
--   to persons having a delete rule (0022 converted the ones that existed then). The IT Inventory
--   tables came later and their person columns have NO delete rule, so the delete fails with
--   'violates foreign key constraint ..._fkey' for anyone who ever created, edited, assigned or
--   received back an asset.
--   Found on live before applying (2026-11-19): assets, asset_types and asset_value_types
--   created_by / updated_by were ON DELETE CASCADE, so deleting a person would also have DELETED
--   the assets and settings they created. Every other column below was NO ACTION.
--
-- CHANGE
--   "Who did it" columns -> ON DELETE SET NULL. Deleting a person must not delete company assets,
--   settings, maintenance or valuations they created, and must not block the delete either.
--     it.asset_types, it.asset_value_types, it.assets, it.asset_maintenance, it.asset_values:
--       created_by, updated_by
--     it.asset_assignments: assigned_by_person_id (made nullable), returned_to_person_id,
--       created_by, updated_by
--
-- NOT CHANGED (on purpose)
--   it.asset_assignments.person_id (who HELD the asset) keeps blocking the delete: cascading it
--   would erase the inventory history, and an asset still assigned would be left "In Use" with no
--   holder. The app now says: "This employee has IT asset history. Set them Inactive instead."
--
-- Safe to undo (only while no row has a NULL assigned_by_person_id):
--   alter table it.asset_assignments alter column assigned_by_person_id set not null;
--   and re-add each constraint below without "on delete set null".

begin;

alter table it.asset_types drop constraint if exists asset_types_created_by_fkey;
alter table it.asset_types add constraint asset_types_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.asset_types drop constraint if exists asset_types_updated_by_fkey;
alter table it.asset_types add constraint asset_types_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

alter table it.asset_value_types drop constraint if exists asset_value_types_created_by_fkey;
alter table it.asset_value_types add constraint asset_value_types_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.asset_value_types drop constraint if exists asset_value_types_updated_by_fkey;
alter table it.asset_value_types add constraint asset_value_types_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

alter table it.assets drop constraint if exists assets_created_by_fkey;
alter table it.assets add constraint assets_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.assets drop constraint if exists assets_updated_by_fkey;
alter table it.assets add constraint assets_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

alter table it.asset_maintenance drop constraint if exists asset_maintenance_created_by_fkey;
alter table it.asset_maintenance add constraint asset_maintenance_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.asset_maintenance drop constraint if exists asset_maintenance_updated_by_fkey;
alter table it.asset_maintenance add constraint asset_maintenance_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

alter table it.asset_values drop constraint if exists asset_values_created_by_fkey;
alter table it.asset_values add constraint asset_values_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.asset_values drop constraint if exists asset_values_updated_by_fkey;
alter table it.asset_values add constraint asset_values_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

alter table it.asset_assignments alter column assigned_by_person_id drop not null;
alter table it.asset_assignments drop constraint if exists asset_assignments_assigned_by_person_id_fkey;
alter table it.asset_assignments add constraint asset_assignments_assigned_by_person_id_fkey
  foreign key (assigned_by_person_id) references public.persons (id) on delete set null;
alter table it.asset_assignments drop constraint if exists asset_assignments_returned_to_person_id_fkey;
alter table it.asset_assignments add constraint asset_assignments_returned_to_person_id_fkey
  foreign key (returned_to_person_id) references public.persons (id) on delete set null;
alter table it.asset_assignments drop constraint if exists asset_assignments_created_by_fkey;
alter table it.asset_assignments add constraint asset_assignments_created_by_fkey
  foreign key (created_by) references public.persons (id) on delete set null;
alter table it.asset_assignments drop constraint if exists asset_assignments_updated_by_fkey;
alter table it.asset_assignments add constraint asset_assignments_updated_by_fkey
  foreign key (updated_by) references public.persons (id) on delete set null;

commit;

-- CHECK (run after applying): every row should show delete_rule = 'SET NULL', except
-- asset_assignments_person_id_fkey which stays 'NO ACTION'.
--   select tc.table_name, tc.constraint_name, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.referential_constraints rc
--       on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
--     join information_schema.constraint_column_usage cu
--       on cu.constraint_name = tc.constraint_name and cu.constraint_schema = tc.constraint_schema
--    where tc.constraint_schema = 'it' and tc.constraint_type = 'FOREIGN KEY'
--      and cu.table_schema = 'public' and cu.table_name = 'persons'
--      and tc.table_name in ('asset_types', 'asset_value_types', 'assets', 'asset_maintenance',
--                            'asset_values', 'asset_assignments')
--    order by tc.table_name, tc.constraint_name;
