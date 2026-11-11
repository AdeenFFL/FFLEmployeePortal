-- Employee Portal — IT module: configurable default owners per onboarding checklist task TYPE,
-- auto-assigned when a task is created. Mirrors it.category_owners (0038_it_owners_and_assignees.sql)
-- exactly, applied to checklist task types instead of ticket categories — no site dimension
-- (onboarding tasks aren't site-routed the way tickets are) and no membership-pool trigger
-- (there's no existing "pool" table to validate against the way it.site_it_staff does for
-- category owners; any person can be made a task-type owner).

begin;

create table it.task_type_owners (
  task_type text not null,
  person_id uuid not null references public.persons(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  primary key (task_type, person_id)
);

create unique index task_type_owners_one_primary
  on it.task_type_owners (task_type) where is_primary;

alter table it.task_type_owners enable row level security;

create policy "task_type_owners readable by authenticated" on it.task_type_owners
  for select to authenticated using (true);

create policy "task_type_owners write by onboarding assigner" on it.task_type_owners
  for all to authenticated
  using (has_permission('it.onboarding.assign'))
  with check (has_permission('it.onboarding.assign'));

grant select, insert, update, delete on it.task_type_owners to authenticated;

create function it.list_task_type_owners()
returns table (task_type text, person_id uuid, full_name text, is_primary boolean)
language sql
security definer
set search_path = public
stable
as $$
  select o.task_type, o.person_id, p.full_name, o.is_primary
  from it.task_type_owners o
  join persons p on p.id = o.person_id
  where has_permission('it.onboarding.assign') or has_permission('it.onboarding.update')
  order by o.task_type, o.is_primary desc, p.full_name;
$$;

revoke all on function it.list_task_type_owners() from public;
grant execute on function it.list_task_type_owners() to authenticated;

-- Mirrors it.auto_assign_ticket: thin trigger calls this; this does the real lookup + guarded
-- write. No FYI-to-other-owners notification (unlike tickets) — kept simple, not requested.
create function it.auto_assign_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_type text;
  v_primary uuid;
begin
  select task_type into v_task_type from it.checklist_items where id = p_item_id and assigned_to_person_id is null;
  if not found then
    return;
  end if;

  select o.person_id into v_primary
  from it.task_type_owners o
  join persons p on p.id = o.person_id and p.status = 'Active'
  where o.task_type = v_task_type and o.is_primary;

  if v_primary is not null then
    update it.checklist_items set assigned_to_person_id = v_primary where id = p_item_id;
  end if;
end;
$$;

create function it.auto_assign_checklist_item_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform it.auto_assign_checklist_item(new.id);
  return null;
end;
$$;

create trigger trg_checklist_items_auto_assign_insert
  after insert on it.checklist_items
  for each row execute function it.auto_assign_checklist_item_on_insert();

commit;
