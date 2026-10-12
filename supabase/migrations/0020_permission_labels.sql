-- Employee Portal — adds a short, human-readable `label` to every permission. Every admin
-- screen that lists permissions (main Roles & Permissions, each module's own role-permissions
-- screen) was showing the raw `key` (e.g. "route:/admin/audit-log", "core.full_access") as the
-- primary label — meaningful to a developer, not to whoever is actually configuring roles.
-- `description` stays as the longer explanatory line underneath; `label` is the 2-4 word name.

alter table permissions add column label text;

update permissions set label = case key
  when 'route:/admin/audit-log' then 'Audit Log'
  when 'route:/admin/departments' then 'Departments'
  when 'route:/admin/roles' then 'Roles & Permissions'
  when 'route:/admin/sites' then 'Sites'
  when 'route:/admin/users' then 'User Management'
  when 'core.full_access' then 'Full Admin Override'
  when 'module:hr' then 'HR'
  when 'hr.anonymous_feedback.read' then 'View Anonymous Feedback'
  when 'hr.anonymous_feedback.update' then 'Reply to Anonymous Feedback'
  when 'hr.categories.create' then 'Create Ticket Categories'
  when 'hr.categories.delete' then 'Delete Ticket Categories'
  when 'hr.categories.update' then 'Edit Ticket Categories'
  when 'hr.manage_role_permissions' then 'HR Role Permissions'
  when 'hr.tickets.delete' then 'Delete Tickets'
  when 'hr.tickets.read' then 'View Tickets'
  when 'hr.tickets.update' then 'Manage Tickets'
  else initcap(replace(split_part(key, '.', -1), '_', ' '))
end;

alter table permissions alter column label set not null;
