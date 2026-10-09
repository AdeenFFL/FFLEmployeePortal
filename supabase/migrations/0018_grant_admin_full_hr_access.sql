-- Employee Portal — grants the Admin role every HR permission group it doesn't already hold.
-- Admin already had module:hr plus 7 of the 8 CRUD keys (from the 0013/0017 carry-forwards);
-- this closes the last two gaps: hr.manage_role_permissions (never auto-granted to anyone, by
-- design — see 0017) and hr.tickets.delete (a brand-new capability, also never auto-granted).

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select r.id, pg.id, null
from roles r
cross join permission_groups pg
join permission_group_permissions pgp on pgp.permission_group_id = pg.id
join permissions p on p.id = pgp.permission_id
where r.name = 'Admin'
  and p.module = 'hr'
on conflict (role_id, permission_group_id) do nothing;
