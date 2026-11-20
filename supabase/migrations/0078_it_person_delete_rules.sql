-- Replicated from supabase/it-migrations/talha/talha_it_0011_person_delete_rules.sql (applied
-- live 2026-11-19, by Talha).
--
-- Lets Admin > Users delete a person who only touched inventory records (asset_assignments'
-- assigned_by/returned_to go ON DELETE SET NULL instead of blocking the delete).

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
