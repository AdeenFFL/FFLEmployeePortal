-- Replicated from supabase/it-migrations/talha/talha_hr_0009_sign_for_all_roles.sql (applied live
-- 2026-11-19, by Talha; hr.clearance.sign now also on Employee and IT, alongside Admin, Clearance
-- Signer, HR and HRBP). Depends on 0081 (this batch).
--
-- A person has exactly one role, so whoever is supposed to sign a clearance part keeps their
-- normal role instead of needing a dedicated signer role.

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
