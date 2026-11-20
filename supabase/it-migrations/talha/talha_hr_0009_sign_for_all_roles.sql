-- Author:      Talha
-- Branch:      it/talha
-- Feature:     Signer inbox for people who keep their normal role
-- Depends on:  talha_hr_0002 (the hr.clearance.* permissions and grants are live)
-- Applied to live DB: YES (2026-11-19, by Talha; hr.clearance.sign now on Admin, Clearance Signer,
--                     Employee, HR, HRBP, IT)
--
-- WHY: a user has exactly ONE role (Admin > Users has a single Role dropdown). Giving someone
-- the role "Clearance Signer" would REPLACE their real role (for example IT Team Member) and
-- remove its permissions. hr.clearance.sign only OPENS the signer inbox; who may sign what is
-- decided by the table hr.clearance_signers (per site / department). So it is safe to grant it
-- to every role that can already submit a clearance request. People who are not signers simply
-- see an empty inbox.
--
-- It only ADDS grants (on conflict do nothing) and updates one description text.

-- Safe to undo:
--   delete from public.role_permissions rp
--     using public.permissions p, public.permissions q, public.role_permissions rq
--    where rp.permission_id = p.id and p.key = 'hr.clearance.sign'
--      and rq.permission_id = q.id and q.key = 'hr.clearance.request_self'
--      and rq.role_id = rp.role_id
--      and rp.role_id not in (select r.id from public.roles r where r.name in ('Admin', 'Clearance Signer', 'HR', 'HRBP'));

begin;

insert into public.role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
  from public.role_permissions rp
  join public.permissions p_old on p_old.id = rp.permission_id and p_old.key = 'hr.clearance.request_self'
 cross join public.permissions p_new
 where p_new.key = 'hr.clearance.sign'
on conflict do nothing;

update public.permissions
   set description = 'Set who signs each part of the clearance forms at each site and department (also needs View All Clearance Requests to open the screen)'
 where key = 'hr.clearance.manage_signers';

commit;
