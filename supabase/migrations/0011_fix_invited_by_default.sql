-- Employee Portal — Corrective migration.
--
-- invited_users.invited_by has had `default auth.uid()` since 0002_admin_module.sql, back when
-- invited_by referenced profiles(id) and profiles.id WAS auth.uid() (profiles was a 1:1 extension
-- of auth.users). 0008_org_hierarchy_fix_and_identity_split.sql repointed the foreign key to
-- persons(id) but never touched this default — auth.uid() is not a persons.id for any account
-- created after that migration, so any insert relying on the default (rather than passing
-- invited_by explicitly) violates invited_users_invited_by_fkey. Same class of bug as
-- role_permissions.granted_by, fixed the same way in 0010_permission_groups.sql's replacement
-- table: drop the default, require callers to pass the resolved person id explicitly (already
-- done in app/(protected)/admin/users/actions.ts's inviteOrUpdateUser).

alter table invited_users alter column invited_by drop default;
