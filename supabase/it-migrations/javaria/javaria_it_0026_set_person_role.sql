-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Administration → User Management: changing a user's role sticks, and people are told
--              when their access changes. Touches the core identity tables (public.user_roles); the
--              messages go to the portal's notification bell (it.notifications, the only inbox).
-- Depends on:  0008_org_hierarchy_fix_and_identity_split.sql (user_roles), 0019 (is_admin),
--              javaria_it_0003_notifications.sql (it.notify)
-- Applied to live DB: NO
--
-- The bug: saving a new role deleted the person's user_roles rows and inserted the new one as two
-- separate requests. A delete that RLS lets through on no rows doesn't error, so the old role
-- stayed beside the new one and the list kept showing the old role.
-- Now one function does it in one transaction: it removes every other role, adds the new one if
-- missing, and refuses with a message anyone can act on when the caller isn't a full admin (same
-- rule as the "user_roles admin write" policy).
--
-- Notifications
--   * set_person_role: the person is told their new role when it actually changed.
--   * notify_role_access_changed: everyone holding a role is told when its permissions change
--     (Administration, HR and IT Roles & Permissions screens).
--
-- Safe to run again (drops and recreates both functions).

drop function if exists public.set_person_role(uuid, uuid);

-- Returns whether the role changed.
create function public.set_person_role(p_person_id uuid, p_role_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_changed boolean;
begin
  if not is_admin(auth.uid()) then
    raise exception 'Only an administrator with Full Access can change roles';
  end if;
  if not exists (select 1 from persons where id = p_person_id) then
    raise exception 'User not found';
  end if;
  select name into v_role from roles where id = p_role_id;
  if not found then
    raise exception 'Role not found';
  end if;

  v_changed := exists (select 1 from user_roles where person_id = p_person_id and role_id <> p_role_id)
            or not exists (select 1 from user_roles where person_id = p_person_id and role_id = p_role_id);

  delete from user_roles where person_id = p_person_id and role_id <> p_role_id;
  if not exists (select 1 from user_roles where person_id = p_person_id and role_id = p_role_id) then
    insert into user_roles (person_id, role_id, granted_by)
    values (p_person_id, p_role_id, current_person_id());
  end if;

  if v_changed then
    perform it.notify(p_person_id, 'role_changed', 'Your role has changed',
      format('You are now %s. Your menus and access follow the new role.', v_role), '/');
  end if;
  return v_changed;
end;
$$;

revoke all on function public.set_person_role(uuid, uuid) from public;
grant execute on function public.set_person_role(uuid, uuid) to authenticated;

-- Tell everyone holding a role that its permissions changed. Returns how many were told. Only for
-- people who may edit role permissions on one of the three screens.
drop function if exists public.notify_role_access_changed(uuid, text);

create function public.notify_role_access_changed(p_role_id uuid, p_summary text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_person uuid;
  v_count int := 0;
begin
  if not (is_admin(auth.uid())
          or has_permission('route:/admin/roles')
          or has_permission('hr.manage_role_permissions')
          or has_permission('it.manage_role_permissions')) then
    raise exception 'You can''t change role permissions';
  end if;
  select name into v_role from roles where id = p_role_id;
  if not found then
    raise exception 'Role not found';
  end if;

  for v_person in select distinct person_id from user_roles where role_id = p_role_id loop
    perform it.notify(v_person, 'access_changed', 'Your access has changed',
      left(format('Your role %s was updated: %s', v_role, p_summary), 500), '/');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_role_access_changed(uuid, text) from public;
grant execute on function public.notify_role_access_changed(uuid, text) to authenticated;
