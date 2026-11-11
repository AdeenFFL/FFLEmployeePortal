-- Employee Portal — IT module: role assignment becomes its own delegatable onboarding checklist
-- task, backed by a minimal-access "Onboarding Pending" role every new hire starts with. Seeded
-- unconditionally (sort_order 5, before email_account) — every new hire needs a role regardless
-- of email/laptop flags.

begin;

insert into roles (name, description, is_system_role) values
  ('Onboarding Pending', 'Placeholder role for accounts provisioned ahead of day one — grants no real access until the Role Assignment onboarding task is completed', false)
on conflict (name) do nothing;
-- Deliberately zero role_permissions rows — proxy.ts's pending-setup check only requires *a*
-- role, not a permission-bearing one (confirmed: resolve_proxy_access's has_role just checks a
-- user_roles row exists), so this lands someone on /home showing no permission-gated cards
-- rather than erroring or redirecting to /pending-setup.

alter table it.checklist_items drop constraint checklist_items_task_type_check;
alter table it.checklist_items add constraint checklist_items_task_type_check check (task_type in (
  'email_account', 'license_assignment', 'role_assignment', 'access_provisioning',
  'software_installation', 'asset_allocation', 'asset_handover', 'portal_account',
  'email_backup_closure', 'access_revocation', 'hardware_recovery', 'asset_return',
  'license_deactivation', 'other'
));

create or replace function it.lifecycle_seed_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'Onboarding' then
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    select new.id, t.task_type, t.task_name, t.sort_order, new.due_date
    from (values
      ('role_assignment', 'Portal Role Assignment', 5, true),
      ('email_account', 'Email Account Creation', 10, new.email_required),
      ('license_assignment', 'Software License Assignment', 15, new.email_required),
      ('software_installation', 'Software Installation & Device Configuration', 30, true),
      ('asset_allocation', 'Asset Allocation & Assignment Form', 40, new.laptop_required),
      ('asset_handover', 'Asset Handover Confirmation', 45, new.laptop_required),
      ('portal_account', 'Employee Portal Account Creation', 50, true)
    ) as t(task_type, task_name, sort_order, include)
    where t.include;
  elsif new.kind = 'Offboarding' then
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    select new.id, t.task_type, t.task_name, t.sort_order, new.due_date
    from (values
      ('email_backup_closure', 'Email Backup & Account Closure', 10),
      ('access_revocation', 'User Access Revocation', 20),
      ('hardware_recovery', 'Laptop & Hardware Recovery', 30),
      ('asset_return', 'Asset Return Form', 40),
      ('license_deactivation', 'Software License Deactivation', 50)
    ) as t(task_type, task_name, sort_order);
  else
    insert into it.checklist_items (request_id, task_type, task_name, sort_order, due_date)
    values
      (new.id, 'asset_return', 'Return Old Asset', 10, new.due_date),
      (new.id, 'asset_allocation', 'Issue Replacement Asset', 20, new.due_date);
  end if;

  insert into it.onboarding_updates (request_id, author_person_id, update_type, body)
  values (new.id, new.requested_by, 'system',
          format('%s request %s raised for %s', new.kind, new.request_number, new.employee_name));
  return null;
end;
$$;

commit;
