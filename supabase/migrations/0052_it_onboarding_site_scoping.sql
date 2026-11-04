-- Employee Portal — IT module: onboarding process overhaul, part 1 (plan: IT Module — Onboarding
-- Process Overhaul (Phase 1)).
--
--   * Site-scopes it.task_type_owners (previously flat) — mirrors it.category_owners exactly:
--     adds site_id, validates the owner is on that site's IT team (it.site_it_staff), auto-drops
--     on staff removal. A pseudo task_type 'overall_request' (not a real checklist task — just a
--     lookup key in this same table) represents "who is the default IT Executive for onboarding
--     at this site", reusing the identical owner/primary/pool machinery instead of a new table.
--   * it.auto_assign_checklist_item becomes site-aware (own request's site_id).
--   * New it.auto_assign_lifecycle_request: sets it_executive_person_id to the site's primary
--     'overall_request' owner on a new request, same spirit as it.auto_assign_ticket. Manual
--     "Take over" (takeOwnership) stays as the override path, unchanged.
--   * Onboarding/Offboarding visibility gets the same 3-tier model as tickets: own/assigned
--     always visible; it.onboarding.read + it.site_it_staff membership -> that site's requests;
--     new it.onboarding.read_all -> every site. Existing it.onboarding.read holders are backfilled
--     with read_all so nobody loses access they have today.
--   * Drops the separate "Portal Role Assignment" checklist task (task_type 'role_assignment') —
--     merged into "Employee Portal Account Creation" (task_type 'portal_account'), which becomes
--     the one step where the owner picks a role and the account is created/upgraded.

begin;

-- ===========================================================================
-- PART A — Site-scoped task-type owners.
-- ===========================================================================

alter table it.task_type_owners add column site_id uuid references public.org_units(id) on delete cascade;

drop index it.task_type_owners_one_primary;
alter table it.task_type_owners drop constraint task_type_owners_pkey;

-- Backfill: a person on exactly one site's IT team gets that site; anyone on none or several is
-- left with a null site_id (not guessable) and is flagged below for manual follow-up.
update it.task_type_owners o
set site_id = s.only_site_id
from (
  select person_id, (array_agg(site_id))[1] as only_site_id
  from it.site_it_staff
  group by person_id
  having count(*) = 1
) s
where s.person_id = o.person_id;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from it.task_type_owners where site_id is null;
  if v_count > 0 then
    raise notice 'Reconcile manually: % task_type_owners row(s) left with no site (owner is on 0 or 2+ sites'' IT teams) — assign a site by hand on /it/settings/owners.', v_count;
  end if;
end $$;

-- Rows that couldn't be backfilled are dropped rather than kept half-migrated with a null site
-- (the new primary key and pool trigger both require a real site); the notice above already
-- told the team which people need re-adding.
delete from it.task_type_owners where site_id is null;

alter table it.task_type_owners alter column site_id set not null;
alter table it.task_type_owners add primary key (task_type, site_id, person_id);

create unique index task_type_owners_one_primary
  on it.task_type_owners (task_type, site_id) where is_primary;
create index task_type_owners_site_idx on it.task_type_owners (site_id);

-- Same pool rule as it.category_owners: an owner must be on that site's IT team.
create function it.check_task_type_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from it.site_it_staff where site_id = new.site_id and person_id = new.person_id
  ) then
    raise exception 'Task owners must be on that site''s IT team (Sites & IT Staff)';
  end if;
  new.created_by := coalesce(new.created_by, current_person_id());
  return new;
end;
$$;

create trigger trg_check_task_type_owner
  before insert or update on it.task_type_owners
  for each row execute function it.check_task_type_owner();

create function it.drop_task_type_owner_on_staff_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from it.task_type_owners where site_id = old.site_id and person_id = old.person_id;
  return null;
end;
$$;

create trigger trg_drop_task_type_owner_on_staff_removal
  after delete on it.site_it_staff
  for each row execute function it.drop_task_type_owner_on_staff_removal();

drop function if exists it.list_task_type_owners();

create function it.list_task_type_owners()
returns table (task_type text, site_id uuid, person_id uuid, full_name text, is_primary boolean)
language sql
security definer
set search_path = public
stable
as $$
  select o.task_type, o.site_id, o.person_id, p.full_name, o.is_primary
  from it.task_type_owners o
  join persons p on p.id = o.person_id
  where has_permission('it.onboarding.assign') or has_permission('it.onboarding.update')
  order by o.task_type, o.is_primary desc, p.full_name;
$$;

-- ===========================================================================
-- PART B — Auto-assignment, now site-aware.
-- ===========================================================================

create or replace function it.auto_assign_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_type text;
  v_request_id uuid;
  v_site_id uuid;
  v_primary uuid;
begin
  select task_type, request_id into v_task_type, v_request_id
  from it.checklist_items where id = p_item_id and assigned_to_person_id is null;
  if not found then
    return;
  end if;

  select site_id into v_site_id from it.onboarding_offboarding where id = v_request_id;
  if v_site_id is null then
    return;
  end if;

  select o.person_id into v_primary
  from it.task_type_owners o
  join persons p on p.id = o.person_id and p.status = 'Active'
  where o.task_type = v_task_type and o.site_id = v_site_id and o.is_primary;

  if v_primary is not null then
    update it.checklist_items set assigned_to_person_id = v_primary where id = p_item_id;
  end if;
end;
$$;

-- Sets it_executive_person_id on a brand-new request from the site's 'overall_request' owner —
-- same idea as it.auto_assign_ticket, scoped to one pseudo task-type key instead of a
-- category/subcategory pair. Only acts while the request is still unowned.
create function it.auto_assign_lifecycle_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
  v_primary uuid;
begin
  select site_id into v_site_id
  from it.onboarding_offboarding
  where id = p_request_id and it_executive_person_id is null;
  if v_site_id is null then
    return;
  end if;

  select o.person_id into v_primary
  from it.task_type_owners o
  join persons p on p.id = o.person_id and p.status = 'Active'
  where o.task_type = 'overall_request' and o.site_id = v_site_id and o.is_primary;

  if v_primary is not null then
    update it.onboarding_offboarding set it_executive_person_id = v_primary where id = p_request_id;
  end if;
end;
$$;

create function it.auto_assign_lifecycle_request_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform it.auto_assign_lifecycle_request(new.id);
  return null;
end;
$$;

create trigger trg_lifecycle_auto_assign_insert
  after insert on it.onboarding_offboarding
  for each row execute function it.auto_assign_lifecycle_request_on_insert();

revoke all on function it.auto_assign_lifecycle_request(uuid) from public;
revoke all on function it.auto_assign_lifecycle_request_on_insert() from public;
revoke all on function it.check_task_type_owner() from public;
revoke all on function it.drop_task_type_owner_on_staff_removal() from public;
revoke all on function it.list_task_type_owners() from public;
grant execute on function it.list_task_type_owners() to authenticated;

-- ===========================================================================
-- PART C — Onboarding/Offboarding visibility, mirroring tickets' 3-tier model.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.onboarding.read_all', 'it', 'View All Sites'' Onboarding Requests',
   'HQ-level: see every site''s onboarding/offboarding/replacement requests, not just sites you''re on the IT team for')
on conflict (key) do nothing;

-- Rollout safety: everyone who can read onboarding today keeps seeing every site.
insert into role_permissions (role_id, permission_id, granted_by)
select distinct rp.role_id, p_new.id, null::uuid
from role_permissions rp
join permissions p_old on p_old.id = rp.permission_id and p_old.key = 'it.onboarding.read'
cross join permissions p_new
where p_new.key = 'it.onboarding.read_all'
on conflict do nothing;

drop policy "onboarding_offboarding select" on it.onboarding_offboarding;
create policy "onboarding_offboarding select" on it.onboarding_offboarding
  for select to authenticated using (
    has_permission('it.onboarding.read_all')
    or (has_permission('it.onboarding.read') and site_id is not null and it.is_site_member(site_id))
    or requested_by = current_person_id()
    or (kind = 'Onboarding' and person_id = current_person_id())
    or it.is_lifecycle_assignee(id)
  );
-- checklist_items / onboarding_updates select policies already defer to this one via
-- "exists (select 1 from it.onboarding_offboarding r where r.id = request_id)" — no change needed.

-- ===========================================================================
-- PART D — Drop the separate "Portal Role Assignment" task (merged into "Employee Portal
-- Account Creation" — see completePortalAccountTask in app/(protected)/it/onboarding/actions.ts).
-- ===========================================================================

delete from it.checklist_items where task_type = 'role_assignment';

alter table it.checklist_items drop constraint checklist_items_task_type_check;
alter table it.checklist_items add constraint checklist_items_task_type_check check (task_type in (
  'email_account', 'license_assignment', 'access_provisioning',
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
