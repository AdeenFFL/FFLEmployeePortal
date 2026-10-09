-- Employee Portal — retires 3 pre-module "route:x" permissions that the Roles screen's
-- "Module Access" split (0013) left behind, causing the exact confusion flagged after shipping
-- it: these still showed up as their own one-off cards, duplicating or shadowing the new
-- module-level toggles.
--
-- route:/hr/dashboard duplicates module:hr now that HR is a real module (lib/auth/
-- route-permissions.ts repoints /hr/dashboard to module:hr) — carry forward every role that
-- currently holds route:/hr/dashboard to module:hr first, so retiring the old gate doesn't lock
-- anyone out of a page they could already reach.
--
-- route:/home and route:/profile are granted to every single role already (core screens, not a
-- module) — proxy.ts's route-permissions map now leaves them unlisted entirely, which falls
-- through to "allowed for any active, role-assigned user" — same real-world access, minus a
-- toggle that could never meaningfully be turned off.
--
-- route:/it/dashboard is NOT touched here — IT isn't a real module yet (no module:it), so
-- there's nothing to consolidate into. Same treatment once IT gets its own M1.

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'module:hr'
where og.module = 'hr' and og.name = 'route:/hr/dashboard'
on conflict (role_id, permission_group_id) do nothing;

delete from permission_groups where module = 'hr' and name = 'route:/hr/dashboard';
delete from permissions where key = 'route:/hr/dashboard';

delete from permission_groups where module = 'employee' and name = 'route:/home';
delete from permissions where key = 'route:/home';

delete from permission_groups where module = 'profile' and name = 'route:/profile';
delete from permissions where key = 'route:/profile';
