-- Replicated from supabase/it-migrations/talha/talha_hr_0004_clearance_signer_lookups.sql (applied
-- live 2026-11-13, by Talha). Depends on 0080-0082 (this batch).
--
-- Clearance Signers screen (/hr/admin/clearance-signers): lookups and changes.

begin;

-- ---------------------------------------------------------------------
-- 1. Sites and departments
-- ---------------------------------------------------------------------
create or replace function hr.clearance_list_units()
returns table (id uuid, name text, type text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('hr.clearance.manage_signers')
          or public.has_permission('hr.clearance.read_all')) then
    raise exception 'You are not allowed to view clearance signers.' using errcode = '42501';
  end if;

  return query
    select o.id, o.name, o.type
      from public.org_units o
     where o.is_active and o.type in ('Site', 'Department')
     order by o.type, o.name;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. All signers, with the person's and the unit's details
-- ---------------------------------------------------------------------
create or replace function hr.clearance_list_signers()
returns table (
  id              uuid,
  slot_key        text,
  site_id         uuid,
  department_id   uuid,
  person_id       uuid,
  is_primary      boolean,
  full_name       text,
  employee_code   text,
  designation     text,
  person_status  text,
  unit_name       text,
  unit_is_active  boolean,
  can_open_inbox  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('hr.clearance.manage_signers')
          or public.has_permission('hr.clearance.read_all')) then
    raise exception 'You are not allowed to view clearance signers.' using errcode = '42501';
  end if;

  return query
    select g.id, g.slot_key, g.site_id, g.department_id, g.person_id, g.is_primary,
           p.full_name, p.employee_code, p.designation, p.status,
           u.name, u.is_active,
           -- does this person hold the "Sign Clearance Forms" permission (so they can open the inbox)?
           exists (select 1
                     from public.user_roles ur
                     join public.role_permissions rp on rp.role_id = ur.role_id
                     join public.permissions pm      on pm.id = rp.permission_id
                    where ur.person_id = g.person_id
                      and pm.key = 'hr.clearance.sign')
      from hr.clearance_signers g
      join public.persons p on p.id = g.person_id
      left join public.org_units u on u.id = coalesce(g.site_id, g.department_id)
     order by g.slot_key, u.name, g.is_primary desc, p.full_name;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Search active employees to add as a signer
-- ---------------------------------------------------------------------
create or replace function hr.clearance_search_people(p_query text, p_limit integer default 20)
returns table (
  person_id       uuid,
  full_name       text,
  employee_code   text,
  designation     text,
  site_name       text,
  department_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_permission('hr.clearance.manage_signers') then
    raise exception 'You are not allowed to search people.' using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  -- treat % and _ typed by the user as ordinary letters
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.full_name, p.employee_code, p.designation, s.name, d.name
      from public.persons p
      left join public.org_units s on s.id = p.site_id
      left join public.org_units d on d.id = p.department_id
     where p.person_type = 'employee'
       and p.status = 'Active'
       and (p.full_name ilike '%' || v_q || '%'
            or p.employee_code ilike '%' || v_q || '%')
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Add a signer (primary only if the cell has nobody yet)
-- ---------------------------------------------------------------------
create or replace function hr.add_clearance_signer(
  p_slot_key      text,
  p_site_id       uuid,
  p_department_id uuid,
  p_person_id     uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    record;
  v_unit    record;
  v_person  record;
  v_primary boolean;
  v_id      uuid;
begin
  if not public.has_permission('hr.clearance.manage_signers') then
    raise exception 'You are not allowed to change clearance signers.' using errcode = '42501';
  end if;

  select s.scope, s.is_active into v_slot
    from hr.clearance_slots s where s.slot_key = p_slot_key;
  if not found or not v_slot.is_active then
    raise exception 'Signature slot not found.';
  end if;

  if v_slot.scope = 'site' then
    if p_site_id is null or p_department_id is not null then
      raise exception 'This slot is set per SITE: choose a site.';
    end if;
    select o.type, o.is_active into v_unit from public.org_units o where o.id = p_site_id;
    if not found or v_unit.type is distinct from 'Site' or not v_unit.is_active then
      raise exception 'Please choose an active Site.';
    end if;
  else
    if p_department_id is null or p_site_id is not null then
      raise exception 'This slot is set per DEPARTMENT: choose a department.';
    end if;
    select o.type, o.is_active into v_unit from public.org_units o where o.id = p_department_id;
    if not found or v_unit.type is distinct from 'Department' or not v_unit.is_active then
      raise exception 'Please choose an active Department.';
    end if;
  end if;

  select p.status, p.person_type into v_person from public.persons p where p.id = p_person_id;
  if not found then
    raise exception 'Person not found.';
  end if;
  if v_person.person_type is distinct from 'employee' or v_person.status is distinct from 'Active' then
    raise exception 'Only an active employee can be a signer.';
  end if;

  v_primary := not exists (
    select 1 from hr.clearance_signers g
     where g.slot_key = p_slot_key
       and ((p_site_id is not null and g.site_id = p_site_id)
         or (p_department_id is not null and g.department_id = p_department_id)));

  begin
    insert into hr.clearance_signers (slot_key, site_id, department_id, person_id, is_primary)
    values (p_slot_key, p_site_id, p_department_id, p_person_id, v_primary)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This person is already a signer here, or the primary signer just changed. Please refresh and try again.';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Remove a signer (the next one becomes primary)
-- ---------------------------------------------------------------------
create or replace function hr.remove_clearance_signer(p_signer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g    record;
  v_next uuid;
begin
  if not public.has_permission('hr.clearance.manage_signers') then
    raise exception 'You are not allowed to change clearance signers.' using errcode = '42501';
  end if;

  select g.id, g.slot_key, g.site_id, g.department_id, g.is_primary
    into v_g
    from hr.clearance_signers g
   where g.id = p_signer_id
   for update;
  if not found then
    raise exception 'Signer not found.';
  end if;

  -- Never remove the LAST signer while an open request still waits for that signature.
  if not exists (
       select 1 from hr.clearance_signers g
        where g.id <> p_signer_id
          and g.slot_key = v_g.slot_key
          and g.site_id       is not distinct from v_g.site_id
          and g.department_id is not distinct from v_g.department_id)
     and exists (
       select 1
         from hr.clearance_cases c
         join hr.clearance_slots s on s.slot_key = v_g.slot_key
        where c.status = 'In Clearance'
          and ((s.scope = 'site'       and c.site_id       = v_g.site_id)
            or (s.scope = 'department' and c.department_id = v_g.department_id))
          and not exists (select 1 from hr.clearance_signoffs o
                           where o.case_id = c.id and o.slot_key = v_g.slot_key)) then
    raise exception 'An open clearance request still needs this signature. Add another signer here first.';
  end if;

  delete from hr.clearance_signers where id = p_signer_id;

  if v_g.is_primary then
    select g.id into v_next
      from hr.clearance_signers g
     where g.slot_key = v_g.slot_key
       and g.site_id       is not distinct from v_g.site_id
       and g.department_id is not distinct from v_g.department_id
     order by g.created_at
     limit 1;
    if v_next is not null then
      update hr.clearance_signers set is_primary = true where id = v_next;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Make one signer the primary (the others in that cell stop being primary)
-- ---------------------------------------------------------------------
create or replace function hr.set_clearance_primary_signer(p_signer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g record;
begin
  if not public.has_permission('hr.clearance.manage_signers') then
    raise exception 'You are not allowed to change clearance signers.' using errcode = '42501';
  end if;

  select g.id, g.slot_key, g.site_id, g.department_id
    into v_g
    from hr.clearance_signers g
   where g.id = p_signer_id
   for update;
  if not found then
    raise exception 'Signer not found.';
  end if;

  update hr.clearance_signers
     set is_primary = false
   where slot_key = v_g.slot_key
     and site_id       is not distinct from v_g.site_id
     and department_id is not distinct from v_g.department_id
     and id <> p_signer_id
     and is_primary;

  update hr.clearance_signers set is_primary = true where id = p_signer_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call: logged-in users only (each function also checks the permission)
-- ---------------------------------------------------------------------
revoke all on function hr.clearance_list_units()                          from public, anon;
revoke all on function hr.clearance_list_signers()                        from public, anon;
revoke all on function hr.clearance_search_people(text, integer)          from public, anon;
revoke all on function hr.add_clearance_signer(text, uuid, uuid, uuid)    from public, anon;
revoke all on function hr.remove_clearance_signer(uuid)                   from public, anon;
revoke all on function hr.set_clearance_primary_signer(uuid)              from public, anon;

grant execute on function hr.clearance_list_units()                       to authenticated, service_role;
grant execute on function hr.clearance_list_signers()                     to authenticated, service_role;
grant execute on function hr.clearance_search_people(text, integer)       to authenticated, service_role;
grant execute on function hr.add_clearance_signer(text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function hr.remove_clearance_signer(uuid)                to authenticated, service_role;
grant execute on function hr.set_clearance_primary_signer(uuid)           to authenticated, service_role;

commit;
