-- Employee Portal — retires route:/it/dashboard, the last leftover pre-module one-off
-- permission on the Roles screen (0015 already retired route:/home, route:/profile,
-- route:/hr/dashboard for the same reason). IT isn't a real module yet, so there's no module:it
-- to carry grants forward into like HR got — lib/auth/route-permissions.ts simply drops the
-- /it/dashboard entry and lets it fall through to "allowed for any active, role-assigned user",
-- same as /home and /profile. Give it a real module:it gate once IT gets its own M1.

delete from permission_groups where module = 'it' and name = 'route:/it/dashboard';
delete from permissions where key = 'route:/it/dashboard';
