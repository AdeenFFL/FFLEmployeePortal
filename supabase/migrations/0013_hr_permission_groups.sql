-- Employee Portal — permission groups for the 4 HR permission codes added by
-- 0012_hr_module.sql. Same 1:1 group-per-permission convention every other permission in this
-- system already uses (see route:/hr/dashboard etc.) — role_permission_groups is still the only
-- thing proxy.ts's has_permission() ultimately reads, so a permission with no group can never be
-- granted to a role at all. 0012 deliberately skipped this ("config, not a migration"), but it
-- turns out the group itself is *not* optional plumbing the UI can route around — without it
-- there is no toggle anywhere for an admin to grant module:hr or hr.manage_* to any role. This
-- migration seeds the only part of "config" that actually has to exist before the Roles screen
-- can show a toggle; which roles get it is still decided in the UI, not here.

insert into permission_groups (module, name, description)
select p.module, p.key, p.description
from permissions p
where p.key in ('module:hr', 'hr.manage_tickets', 'hr.manage_anonymous_feedback', 'hr.manage_categories')
on conflict (module, name) do nothing;

insert into permission_group_permissions (permission_group_id, permission_id)
select pg.id, p.id
from permissions p
join permission_groups pg on pg.module = p.module and pg.name = p.key
where p.key in ('module:hr', 'hr.manage_tickets', 'hr.manage_anonymous_feedback', 'hr.manage_categories')
on conflict do nothing;
