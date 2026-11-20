-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Offboarding clearance system - permissions, roles and grants (follows talha_hr_0001)
-- Depends on:  talha_hr_0001_clearance_system.sql (the functions and policies use these keys),
--              public.permissions (label is NOT NULL), public.roles (name unique),
--              public.role_permissions (role_id, permission_id, granted_by).
-- Applied to live DB: YES (2026-11-12, by Talha)
--
-- WHAT THIS ADDS
--   7 permissions, 2 roles (HRBP, Clearance Signer) and the grants below.
--   It only ADDS rows (on conflict do nothing). It never removes or changes an existing grant.
--
-- WHO GETS WHAT (x = granted). Change here, or later with another SQL file:
--   key                            Admin  HR  HRBP  Signer  Employee
--   hr.clearance.request_self        x                x       x      (+ every role that holds hr.offboarding.create_self)
--   hr.clearance.forward             x           x
--   hr.clearance.read_all            x     x     x
--   hr.clearance.manage_signers      x     x
--   hr.clearance.manage_forms        x     x
--   hr.clearance.sign                x                x
--   hr.clearance.print               x     x     x
--
-- NOTES
--   * Who signs WHAT at WHICH site is NOT a role: it is the table hr.clearance_signers.
--     'Clearance Signer' only opens the signer inbox; the signers table decides which part.
--   * has_permission() does not treat Admin as special, so Admin is granted explicitly.
--   * These hr.* keys will NOT show on /admin/roles (it hides hr.*) and will not show on
--     /hr/admin/roles until HR_PERMISSION_SECTIONS in that page gets a new section.
--     Add that section only AFTER this file has run (that page warns if a listed key is missing).

-- Safe to undo (removes only what this file adds):
--   delete from public.role_permissions rp using public.permissions p
--    where rp.permission_id = p.id and p.key like 'hr.clearance.%';
--   delete from public.permissions where key like 'hr.clearance.%';
--   delete from public.roles where name in ('HRBP', 'Clearance Signer')
--      and not exists (select 1 from public.user_roles ur where ur.role_id = roles.id);

begin;

insert into public.permissions (key, module, label, description) values
  ('hr.clearance.request_self',   'hr', 'Submit Offboarding Request (Self)',
   'Submit your own offboarding / clearance request from your profile'),
  ('hr.clearance.forward',        'hr', 'Forward Offboarding Requests',
   'Forward submitted offboarding requests for clearance, start one for an employee, cancel a request'),
  ('hr.clearance.read_all',       'hr', 'View All Clearance Requests',
   'See every offboarding clearance request and all the form answers'),
  ('hr.clearance.manage_signers', 'hr', 'Manage Clearance Signers',
   'Set who signs each part of the clearance forms at each site and department'),
  ('hr.clearance.manage_forms',   'hr', 'Manage Clearance Form Lines',
   'Add or edit the lines of the clearance forms'),
  ('hr.clearance.sign',           'hr', 'Sign Clearance Forms',
   'Open the signer inbox, fill and sign your own part of the clearance forms (you must also be set as a signer)'),
  ('hr.clearance.print',          'hr', 'Print Clearance Forms',
   'Open the print view of the clearance forms')
on conflict (key) do nothing;

insert into public.roles (name, description, is_system_role) values
  ('HRBP',             'HR Business Partner: forwards offboarding requests for clearance', false),
  ('Clearance Signer', 'Signs their own part of the offboarding clearance forms (the signers table sets which part and which site)', false)
on conflict (name) do nothing;

with wanted (role_name, perm_key) as (
  values
    ('Admin', 'hr.clearance.request_self'),
    ('Admin', 'hr.clearance.forward'),
    ('Admin', 'hr.clearance.read_all'),
    ('Admin', 'hr.clearance.manage_signers'),
    ('Admin', 'hr.clearance.manage_forms'),
    ('Admin', 'hr.clearance.sign'),
    ('Admin', 'hr.clearance.print'),

    ('Employee', 'hr.clearance.request_self'),

    ('HR', 'hr.clearance.read_all'),
    ('HR', 'hr.clearance.manage_signers'),
    ('HR', 'hr.clearance.manage_forms'),
    ('HR', 'hr.clearance.print'),

    ('HRBP', 'hr.clearance.forward'),
    ('HRBP', 'hr.clearance.read_all'),
    ('HRBP', 'hr.clearance.print'),

    ('Clearance Signer', 'hr.clearance.sign'),
    ('Clearance Signer', 'hr.clearance.request_self')
)
insert into public.role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
  from wanted w
  join public.roles r        on r.name = w.role_name
  join public.permissions p  on p.key  = w.perm_key
on conflict do nothing;

-- Every role that can already submit the old self-offboarding can submit a clearance request too.
insert into public.role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
  from public.role_permissions rp
  join public.permissions p_old on p_old.id = rp.permission_id and p_old.key = 'hr.offboarding.create_self'
 cross join public.permissions p_new
 where p_new.key = 'hr.clearance.request_self'
on conflict do nothing;

commit;
