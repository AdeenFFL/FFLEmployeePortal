-- Employee Portal — decomposes HR's 3 coarse "manage_*" permissions into real per-operation
-- (create/read/update/delete) permissions, so a role can be granted "can view tickets" without
-- also getting "can delete tickets" — a blanket has_permission('hr.manage_tickets') check
-- covering every operation was the opposite of what per-module CRUD config should look like.
-- Also adds hr.manage_role_permissions, gating /hr/admin/roles itself (who gets to configure
-- HR's permissions) — previously that screen piggybacked on the global route:/admin/roles,
-- which defeated the "configure module-wise roles within the module itself" goal.
--
-- New keys:
--   hr.tickets.read / hr.tickets.update / hr.tickets.delete
--     (no hr.tickets.create — tickets are submitted by the employee themselves, gated by
--     module:hr already; HR staff never "create" a ticket on someone's behalf in this pass)
--   hr.categories.create / hr.categories.update / hr.categories.delete
--     (no hr.categories.read — ticket_categories stays universally readable; every employee
--     needs the list to submit a ticket, that's not an HR-staff concern)
--   hr.anonymous_feedback.read / hr.anonymous_feedback.update
--     (read = see conversations/messages for your department; update = reply, and manage who's
--     an HRBP for a department — no create/delete, conversations are anonymous-submitter-only
--     and nothing deletes one)
--   hr.manage_role_permissions
--     (configure which role gets which of the above, from /hr/admin/roles)

-- ---------------------------------------------------------------------------
-- Part 1 — new permission rows + their 1:1 permission groups (0013's convention).
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('hr.tickets.read', 'hr', 'View all tickets and their threads'),
  ('hr.tickets.update', 'hr', 'Assign, reply to, and change the status of tickets'),
  ('hr.tickets.delete', 'hr', 'Delete tickets'),
  ('hr.categories.create', 'hr', 'Create ticket categories'),
  ('hr.categories.update', 'hr', 'Edit ticket categories and manage their assignees'),
  ('hr.categories.delete', 'hr', 'Delete ticket categories'),
  ('hr.anonymous_feedback.read', 'hr', 'Read anonymous conversations for your assigned department(s)'),
  ('hr.anonymous_feedback.update', 'hr', 'Reply to anonymous conversations and manage HRBP department assignments'),
  ('hr.manage_role_permissions', 'hr', 'Configure which portal role has which HR permission')
on conflict (key) do nothing;

insert into permission_groups (module, name, description)
select p.module, p.key, p.description
from permissions p
where p.key in (
  'hr.tickets.read', 'hr.tickets.update', 'hr.tickets.delete',
  'hr.categories.create', 'hr.categories.update', 'hr.categories.delete',
  'hr.anonymous_feedback.read', 'hr.anonymous_feedback.update',
  'hr.manage_role_permissions'
)
on conflict (module, name) do nothing;

insert into permission_group_permissions (permission_group_id, permission_id)
select pg.id, p.id
from permissions p
join permission_groups pg on pg.module = p.module and pg.name = p.key
where p.key in (
  'hr.tickets.read', 'hr.tickets.update', 'hr.tickets.delete',
  'hr.categories.create', 'hr.categories.update', 'hr.categories.delete',
  'hr.anonymous_feedback.read', 'hr.anonymous_feedback.update',
  'hr.manage_role_permissions'
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Part 2 — carry forward existing grants so retiring the coarse permissions doesn't drop
-- anyone's actual access. hr.manage_tickets holders get read+update (NOT delete — a brand-new
-- capability nobody is silently granted). hr.manage_categories holders get all 3 (full parity
-- with what that permission used to cover). hr.manage_anonymous_feedback holders get read+update.
-- hr.manage_role_permissions is NOT carried forward from anything — same reasoning as
-- 0013/§4: granting the ability to configure permissions is deliberate, never automatic.
-- ---------------------------------------------------------------------------

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.tickets.read'
where og.module = 'hr' and og.name = 'hr.manage_tickets'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.tickets.update'
where og.module = 'hr' and og.name = 'hr.manage_tickets'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.categories.create'
where og.module = 'hr' and og.name = 'hr.manage_categories'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.categories.update'
where og.module = 'hr' and og.name = 'hr.manage_categories'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.categories.delete'
where og.module = 'hr' and og.name = 'hr.manage_categories'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.anonymous_feedback.read'
where og.module = 'hr' and og.name = 'hr.manage_anonymous_feedback'
on conflict (role_id, permission_group_id) do nothing;

insert into role_permission_groups (role_id, permission_group_id, granted_by)
select rpg.role_id, mg.id, rpg.granted_by
from role_permission_groups rpg
join permission_groups og on og.id = rpg.permission_group_id
join permission_groups mg on mg.module = 'hr' and mg.name = 'hr.anonymous_feedback.update'
where og.module = 'hr' and og.name = 'hr.manage_anonymous_feedback'
on conflict (role_id, permission_group_id) do nothing;

-- ---------------------------------------------------------------------------
-- Part 3 — RLS: drop the coarse-permission policies, recreate split per-operation.
-- ---------------------------------------------------------------------------

drop policy "tickets select own or hr staff" on hr.tickets;
create policy "tickets select own or hr staff" on hr.tickets
  for select to authenticated using (
    person_id = current_person_id() or has_permission('hr.tickets.read')
  );

drop policy "tickets update by hr staff" on hr.tickets;
create policy "tickets update by hr staff" on hr.tickets
  for update to authenticated
  using (has_permission('hr.tickets.update')) with check (has_permission('hr.tickets.update'));

create policy "tickets delete by hr staff" on hr.tickets
  for delete to authenticated using (has_permission('hr.tickets.delete'));

drop policy "ticket_messages select own ticket or hr staff" on hr.ticket_messages;
create policy "ticket_messages select own ticket or hr staff" on hr.ticket_messages
  for select to authenticated using (
    has_permission('hr.tickets.read')
    or exists (select 1 from hr.tickets t where t.id = ticket_id and t.person_id = current_person_id())
  );

-- An HR-staff reply is treated as an "update" to the ticket's own thread, not a separate
-- capability — same granularity choice as hr.categories.update covering assignee management.
drop policy "ticket_messages insert own ticket or hr staff" on hr.ticket_messages;
create policy "ticket_messages insert own ticket or hr staff" on hr.ticket_messages
  for insert to authenticated with check (
    sender_person_id = current_person_id()
    and (
      has_permission('hr.tickets.update')
      or exists (select 1 from hr.tickets t where t.id = ticket_id and t.person_id = current_person_id())
    )
  );

drop policy "ticket_categories write by hr admin" on hr.ticket_categories;
create policy "ticket_categories insert by hr admin" on hr.ticket_categories
  for insert to authenticated with check (has_permission('hr.categories.create'));
create policy "ticket_categories update by hr admin" on hr.ticket_categories
  for update to authenticated
  using (has_permission('hr.categories.update')) with check (has_permission('hr.categories.update'));
create policy "ticket_categories delete by hr admin" on hr.ticket_categories
  for delete to authenticated using (has_permission('hr.categories.delete'));

-- Assignee management folds into "update a category's configuration" — same granularity choice
-- noted above, rather than a 5th fine-grained permission for just this join table.
drop policy "ticket_category_assignees write by hr admin" on hr.ticket_category_assignees;
create policy "ticket_category_assignees insert by hr admin" on hr.ticket_category_assignees
  for insert to authenticated with check (has_permission('hr.categories.update'));
create policy "ticket_category_assignees delete by hr admin" on hr.ticket_category_assignees
  for delete to authenticated using (has_permission('hr.categories.update'));

drop policy "anonymous_conversations hrbp read own department" on hr.anonymous_conversations;
create policy "anonymous_conversations hrbp read own department" on hr.anonymous_conversations
  for select to authenticated using (
    has_permission('hr.anonymous_feedback.read')
    and exists (
      select 1 from hr.hrbp_departments hd
      where hd.person_id = current_person_id()
        and hd.department_org_unit_id = hr.anonymous_conversations.department_org_unit_id
    )
  );

-- Previously this policy checked ONLY hrbp_departments membership, with no has_permission()
-- check at all — meaning revoking hr.manage_anonymous_feedback from a role didn't actually stop
-- an existing HRBP-department member from reading messages, so long as their hrbp_departments
-- row stayed. Tightened to match the conversations-level policy above while already touching it.
drop policy "anonymous_messages hrbp read own department" on hr.anonymous_messages;
create policy "anonymous_messages hrbp read own department" on hr.anonymous_messages
  for select to authenticated using (
    has_permission('hr.anonymous_feedback.read')
    and exists (
      select 1 from hr.anonymous_conversations c
      join hr.hrbp_departments hd on hd.department_org_unit_id = c.department_org_unit_id
      where c.id = hr.anonymous_messages.conversation_id
        and hd.person_id = current_person_id()
    )
  );

drop policy "hrbp_departments hr read own, admin manage" on hr.hrbp_departments;
create policy "hrbp_departments hr read own, admin manage" on hr.hrbp_departments
  for select to authenticated using (
    person_id = current_person_id() or has_permission('hr.anonymous_feedback.update')
  );

drop policy "hrbp_departments admin write" on hr.hrbp_departments;
create policy "hrbp_departments admin write" on hr.hrbp_departments
  for insert to authenticated with check (has_permission('hr.anonymous_feedback.update'));

drop policy "hrbp_departments admin delete" on hr.hrbp_departments;
create policy "hrbp_departments admin delete" on hr.hrbp_departments
  for delete to authenticated using (has_permission('hr.anonymous_feedback.update'));

-- ---------------------------------------------------------------------------
-- Part 4 — retire the 3 coarse permissions (cascades their groups + now-redundant grants).
-- ---------------------------------------------------------------------------

delete from permission_groups where module = 'hr' and name = 'hr.manage_tickets';
delete from permissions where key = 'hr.manage_tickets';

delete from permission_groups where module = 'hr' and name = 'hr.manage_categories';
delete from permissions where key = 'hr.manage_categories';

delete from permission_groups where module = 'hr' and name = 'hr.manage_anonymous_feedback';
delete from permissions where key = 'hr.manage_anonymous_feedback';
