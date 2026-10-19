-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Inventory permissions for the IT roles (decided by Talha, delegated by the boss)
-- Depends on:  public.roles, public.permissions, public.role_permissions;
--              the it.* inventory permission rows from 0024/0026/0028 (already live).
-- Applied to live DB: YES (2026-10-19, by Talha)
--
-- WHY: the roles HOD IT, IT Admin, IT Executive (HQ), IT Site Manager and
-- IT Team Member were created by hand and hold the module:it door but NO it.*
-- permissions. Admin and IT already have every inventory permission and are
-- NOT touched here.
--
-- This file only ADDS grants for the inventory keys below. It never removes a
-- grant, never touches ticket / onboarding permissions (Javaria's), and never
-- touches it.manage_role_permissions.
--
-- THE MATRIX (x = granted):
--   key                           IT Admin  IT Exec(HQ)  IT Team  HOD IT  Site Mgr
--   it.assets.read                   x          x           x        x        x
--   it.assets.create                 x          x
--   it.assets.update                 x          x
--   it.assets.delete                 x
--   it.assets.assign                 x          x           x                 x
--   it.maintenance.update            x          x           x                 x
--   it.stock.read                    x          x           x        x        x
--   it.stock.update                  x          x
--   it.valuation.update              x
--   it.inventory_settings.update     x
--
-- NOTE for IT Site Manager: site-only visibility is NOT built yet (plan 07,
-- lines 202-204). Until a scoped permission check exists, anyone with
-- it.assets.read sees the assets of EVERY site. Delete the 'IT Site Manager'
-- lines below if that is not acceptable yet.

-- Safe to undo (removes only what this file adds, for these five roles):
--   delete from public.role_permissions rp
--    using public.roles r, public.permissions p
--    where rp.role_id = r.id and rp.permission_id = p.id
--      and r.name in ('IT Admin','IT Executive (HQ)','IT Team Member','HOD IT','IT Site Manager')
--      and p.key in ('it.assets.read','it.assets.create','it.assets.update','it.assets.delete',
--                    'it.assets.assign','it.maintenance.update','it.stock.read',
--                    'it.stock.update','it.valuation.update','it.inventory_settings.update');

begin;

with wanted (role_name, perm_key) as (
  values
    -- IT Admin: everything in inventory
    ('IT Admin', 'it.assets.read'),
    ('IT Admin', 'it.assets.create'),
    ('IT Admin', 'it.assets.update'),
    ('IT Admin', 'it.assets.delete'),
    ('IT Admin', 'it.assets.assign'),
    ('IT Admin', 'it.maintenance.update'),
    ('IT Admin', 'it.stock.read'),
    ('IT Admin', 'it.stock.update'),
    ('IT Admin', 'it.valuation.update'),
    ('IT Admin', 'it.inventory_settings.update'),

    -- IT Executive (HQ): registers and assigns assets (BRD 5.5.1, 5.5.5); no delete, valuation or settings
    ('IT Executive (HQ)', 'it.assets.read'),
    ('IT Executive (HQ)', 'it.assets.create'),
    ('IT Executive (HQ)', 'it.assets.update'),
    ('IT Executive (HQ)', 'it.assets.assign'),
    ('IT Executive (HQ)', 'it.maintenance.update'),
    ('IT Executive (HQ)', 'it.stock.read'),
    ('IT Executive (HQ)', 'it.stock.update'),

    -- IT Team Member: allocates / returns assets and logs repairs (BRD 605, 782, 969); cannot register or edit
    ('IT Team Member', 'it.assets.read'),
    ('IT Team Member', 'it.assets.assign'),
    ('IT Team Member', 'it.maintenance.update'),
    ('IT Team Member', 'it.stock.read'),

    -- HOD IT: oversight, read only
    ('HOD IT', 'it.assets.read'),
    ('HOD IT', 'it.stock.read'),

    -- IT Site Manager: same as IT Team Member (see NOTE above about sites)
    ('IT Site Manager', 'it.assets.read'),
    ('IT Site Manager', 'it.assets.assign'),
    ('IT Site Manager', 'it.maintenance.update'),
    ('IT Site Manager', 'it.stock.read')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from wanted w
  join public.roles r        on r.name = w.role_name
  join public.permissions p  on p.key  = w.perm_key
 where not exists (
         select 1
           from public.role_permissions rp
          where rp.role_id = r.id
            and rp.permission_id = p.id
       );

commit;
