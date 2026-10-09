-- Employee Portal — removes the standalone "Permission Groups" admin screen and its now-dead
-- gating permission. The manual compose-a-group UI is no longer needed: every permission group
-- in this system is now seeded directly by its owning module's migration (see
-- 0013_hr_permission_groups.sql's convention) — module:x shows up on /admin/roles' "Module
-- Access" section and <module>.manage_* permissions get their own module admin screen (e.g.
-- /hr/admin/roles). permission_groups / role_permission_groups themselves stay; they're still
-- the real plumbing has_permission() reads, just no longer something an admin edits by hand.

delete from permission_groups where module = 'admin' and name = 'route:/admin/permission-groups';
delete from permissions where key = 'route:/admin/permission-groups';
