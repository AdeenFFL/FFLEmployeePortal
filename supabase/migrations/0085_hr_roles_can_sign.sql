-- Replicated from supabase/it-migrations/talha/talha_hr_0006_hr_roles_can_sign.sql (applied live
-- 2026-11-17, by Talha). Depends on 0081 (this batch) for the hr.clearance.sign permission.
--
-- Lets the HR and HRBP roles open the signer inbox (/hr/clearance), not only Admin and the
-- dedicated Clearance Signer role.

begin;

insert into public.role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
  from (values ('HR'), ('HRBP')) as w (role_name)
  join public.roles r        on r.name = w.role_name
  join public.permissions p  on p.key  = 'hr.clearance.sign'
on conflict do nothing;

commit;
