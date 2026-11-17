-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Signer inbox (/hr/clearance) - let the HR and HRBP roles open it
-- Depends on:  talha_hr_0002 (the permission hr.clearance.sign and the roles HR / HRBP exist)
-- Applied to live DB: YES (2026-11-17, by Talha)
--
-- WHY: the signer inbox route is gated on hr.clearance.sign. 0002 gave that key only to Admin
-- and to the role "Clearance Signer". The person who signs PAGE ONE (the 'hr' slot) is often an
-- HR or HRBP person, who would then be blocked from the inbox. Who actually signs which part is
-- still decided by the table hr.clearance_signers, not by this permission.
--
-- It only ADDS two grants (on conflict do nothing). Nothing is removed or changed.

-- Safe to undo:
--   delete from public.role_permissions rp
--     using public.roles r, public.permissions p
--    where rp.role_id = r.id and rp.permission_id = p.id
--      and p.key = 'hr.clearance.sign' and r.name in ('HR', 'HRBP');

begin;

insert into public.role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
  from (values ('HR'), ('HRBP')) as w (role_name)
  join public.roles r        on r.name = w.role_name
  join public.permissions p  on p.key  = 'hr.clearance.sign'
on conflict do nothing;

commit;
