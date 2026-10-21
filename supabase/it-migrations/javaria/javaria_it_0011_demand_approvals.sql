-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 3 — Department-head approval
--              (09-it-procurement-plan.md §5 Phase 3; BRD §5.5.4–5.5.6, plan addition P3)
-- Depends on:  javaria_it_0009_procurement_masters.sql, javaria_it_0010_demands.sql
-- Applied to live DB: NO
--
-- What this does
--   * it.department_approvers (P3) — who heads which department for procurement. has_permission()
--     can't say WHICH department, so the mapping lives here (same idea as it.category_owners).
--     A person can head several departments; a department can have several approvers (any one
--     decides). Maintained on /it/procurement/settings/approvers (it.procurement_settings.update).
--   * Approving needs BOTH it.demands.approve AND a can_approve_demands row for the demand's
--     department. A requester can never approve their own demand.
--   * it.submit_demand_for_approval(): Categorized → Pending Approval (site procurement staff),
--     notifies the department's approvers (§5.5.4). Refused if the department has no approver.
--   * it.decide_demand(): Approved / Partially Approved (with quantity) / Rejected, comments,
--     timestamp captured automatically (§5.5.5). Writes it.demand_approvals (append-only) and sets
--     the demand's status + approved_quantity. Requester and site procurement are notified;
--     reject / partial always carry the comment (§5.5.6).
--   * Approvers see the demands of their departments once they've been sent for approval (and
--     their non-internal timeline), and the product / vendor masters.
--   * Pending Approval can still be cancelled by site procurement (e.g. raised by mistake).
--
-- Functions REPLACED (same signatures): it.can_read_procurement_masters, it.demand_person_names,
-- it.demands_before_update (adds the Pending Approval cancel).
-- Policies REPLACED: demands select, demand_updates select / insert.

-- ===========================================================================
-- PART A — Tables.
-- ===========================================================================

create table it.department_approvers (
  department_id uuid not null references public.org_units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  can_approve_demands boolean not null default true,
  can_approve_invoices boolean not null default true, -- used from Phase 5
  created_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  primary key (department_id, person_id)
);

create index department_approvers_person_idx on it.department_approvers (person_id);

create table it.demand_approvals (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references it.demands(id) on delete cascade,
  approver_person_id uuid not null references public.persons(id),
  decision text not null check (decision in ('Approved', 'Partially Approved', 'Rejected')),
  approved_quantity int not null check (approved_quantity >= 0),
  comments text,
  decided_at timestamptz not null default now(),
  constraint demand_approvals_comment_needed
    check (decision = 'Approved' or length(trim(coalesce(comments, ''))) > 0)
);

create index demand_approvals_demand_idx on it.demand_approvals (demand_id, decided_at);
create index demand_approvals_approver_idx on it.demand_approvals (approver_person_id, decided_at desc);

-- ===========================================================================
-- PART B — Helpers.
-- ===========================================================================

create function it.is_demand_approver(p_department_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.demands.approve')
     and exists (
       select 1 from it.department_approvers a
       where a.department_id = p_department_id
         and a.person_id = current_person_id()
         and a.can_approve_demands
     );
$$;

-- Departments the current user approves demands for (approval inbox).
create function it.my_approver_departments()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select a.department_id
  from it.department_approvers a
  where a.person_id = current_person_id()
    and a.can_approve_demands
    and has_permission('it.demands.approve');
$$;

-- People who can actually decide a department's demands (mapped AND holding the permission).
create function it.demand_approvers_for(p_department_id uuid)
returns table (person_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select distinct a.person_id
  from it.department_approvers a
  join user_roles ur on ur.person_id = a.person_id
  join role_permissions rp on rp.role_id = ur.role_id
  join permissions perm on perm.id = rp.permission_id and perm.key = 'it.demands.approve'
  where a.department_id = p_department_id and a.can_approve_demands;
$$;

-- Masters readable by approvers too (they see product names on what they approve).
create or replace function it.can_read_procurement_masters()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.vendors.update')
      or has_permission('it.products.update')
      or has_permission('it.procurement_settings.update')
      or has_permission('it.demands.create')
      or has_permission('it.demands.read')
      or has_permission('it.demands.read_all')
      or has_permission('it.demands.update')
      or has_permission('it.demands.approve')
      or has_permission('it.payments.update')
      or has_permission('it.assets.read');
$$;

-- Settings screen + demand page: approvers with names.
create function it.list_department_approvers()
returns table (
  department_id uuid,
  person_id uuid,
  full_name text,
  designation text,
  can_approve_demands boolean,
  can_approve_invoices boolean,
  has_permission boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select a.department_id, a.person_id, p.full_name, p.designation,
         a.can_approve_demands, a.can_approve_invoices,
         exists (select 1 from it.demand_approvers_for(a.department_id) x where x.person_id = a.person_id)
  from it.department_approvers a
  join persons p on p.id = a.person_id
  where has_permission('it.procurement_settings.update')
     or has_permission('it.demands.read')
     or has_permission('it.demands.read_all')
     or has_permission('it.demands.approve')
  order by p.full_name;
$$;

-- Employee picker for the approvers screen.
create function it.search_approver_candidates(p_search text)
returns table (person_id uuid, full_name text, employee_code text, designation text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.employee_code, p.designation
  from persons p
  where has_permission('it.procurement_settings.update')
    and p.person_type = 'employee'
    and p.status = 'Active'
    and coalesce(trim(p_search), '') <> ''
    and (p.full_name ilike '%' || trim(p_search) || '%'
         or p.employee_code ilike '%' || trim(p_search) || '%')
  order by p.full_name
  limit 30;
$$;

revoke all on function it.is_demand_approver(uuid) from public;
revoke all on function it.my_approver_departments() from public;
revoke all on function it.demand_approvers_for(uuid) from public;
revoke all on function it.list_department_approvers() from public;
revoke all on function it.search_approver_candidates(text) from public;
grant execute on function it.is_demand_approver(uuid) to authenticated;
grant execute on function it.my_approver_departments() to authenticated;
grant execute on function it.list_department_approvers() to authenticated;
grant execute on function it.search_approver_candidates(text) to authenticated;

-- ===========================================================================
-- PART C — Submit and decide.
-- ===========================================================================

create function it.submit_demand_for_approval(p_demand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
  v_product text;
  v_person uuid;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if not it.can_process_demand(v_demand.site_id) then
    raise exception 'Only the site''s procurement staff can send a demand for approval';
  end if;
  if v_demand.status <> 'Categorized' then
    raise exception 'Only a categorised demand can be sent for approval (it is %)', v_demand.status;
  end if;
  if not exists (select 1 from it.demand_approvers_for(v_demand.department_id)) then
    raise exception 'The % department has no demand approver yet — add one under Procurement → Department Approvers',
      (select name from org_units where id = v_demand.department_id);
  end if;

  perform set_config('it.demand_system', 'on', true);
  update it.demands set status = 'Pending Approval', updated_by = current_person_id()
  where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  v_product := (select product_name from it.products where id = v_demand.product_id);
  for v_person in select person_id from it.demand_approvers_for(v_demand.department_id) loop
    if v_person is distinct from v_demand.requested_by_person_id then
      perform it.notify_demand_person(v_person, 'demand_approval',
        format('Approval needed: demand %s', v_demand.demand_number),
        format('%s × %s for %s. Justification: %s', v_demand.quantity, v_product,
               (select name from org_units where id = v_demand.department_id), v_demand.justification),
        v_demand.id);
    end if;
  end loop;
end;
$$;

create function it.decide_demand(
  p_demand_id uuid,
  p_decision text,
  p_approved_quantity int,
  p_comments text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_demand it.demands%rowtype;
  v_qty int;
  v_comments text := nullif(trim(coalesce(p_comments, '')), '');
  v_body text;
begin
  select * into v_demand from it.demands where id = p_demand_id and deleted_at is null for update;
  if not found then
    raise exception 'Demand not found';
  end if;
  if v_actor is null or not it.is_demand_approver(v_demand.department_id) then
    raise exception 'You are not an approver for this demand''s department';
  end if;
  if v_demand.requested_by_person_id = v_actor then
    raise exception 'You can''t approve a demand you raised yourself';
  end if;
  if v_demand.status <> 'Pending Approval' then
    raise exception 'This demand is not awaiting approval (it is %)', v_demand.status;
  end if;

  if p_decision = 'Approved' then
    v_qty := v_demand.quantity;
  elsif p_decision = 'Partially Approved' then
    if p_approved_quantity is null or p_approved_quantity < 1 or p_approved_quantity >= v_demand.quantity then
      raise exception 'A partial approval must be between 1 and % (less than requested)', v_demand.quantity - 1;
    end if;
    if v_comments is null then
      raise exception 'Please explain the partial approval';
    end if;
    v_qty := p_approved_quantity;
  elsif p_decision = 'Rejected' then
    if v_comments is null then
      raise exception 'Please give a reason for rejecting';
    end if;
    v_qty := 0;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  insert into it.demand_approvals (demand_id, approver_person_id, decision, approved_quantity, comments)
  values (p_demand_id, v_actor, p_decision, v_qty, v_comments);

  perform set_config('it.demand_system', 'on', true);
  update it.demands
     set status = p_decision, approved_quantity = v_qty, updated_by = v_actor
   where id = p_demand_id;
  perform set_config('it.demand_system', 'off', true);

  -- The status change itself is logged and sent to the requester by the demand triggers; the
  -- timeline gets the decision detail here.
  v_body := case p_decision
    when 'Approved' then format('Approved (%s)', v_qty)
    when 'Partially Approved' then format('Partially approved: %s of %s', v_qty, v_demand.quantity)
    else 'Rejected'
  end || coalesce(' — ' || v_comments, '');
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (p_demand_id, v_actor, 'system', v_body);

  -- §5.5.6: site procurement acts next (assign vendor) or is told of reject / partial.
  perform it.notify_demand_processors(v_demand.site_id, 'demand_decided',
    format('Demand %s %s', v_demand.demand_number, lower(p_decision)), v_body, v_demand.id);
end;
$$;

revoke all on function it.submit_demand_for_approval(uuid) from public;
revoke all on function it.decide_demand(uuid, text, int, text) from public;
grant execute on function it.submit_demand_for_approval(uuid) to authenticated;
grant execute on function it.decide_demand(uuid, text, int, text) to authenticated;

-- The requester's status notification (it.notify_demand_update) should carry the approver's
-- comment for reject / partial. Replaces javaria_it_0010's version.
create or replace function it.notify_demand_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_comment text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status in ('Approved', 'Partially Approved', 'Rejected') then
    select comments into v_comment from it.demand_approvals
    where demand_id = new.id order by decided_at desc limit 1;
  end if;

  perform it.notify_demand_person(new.requested_by_person_id, 'demand_status',
    format('Demand %s: %s', new.demand_number, new.status),
    case new.status
      when 'Cancelled' then 'Cancelled: ' || coalesce(new.cancellation_reason, '')
      when 'Stock Updated' then 'Issued from stock: ' || coalesce(new.stock_note, '')
      when 'Pending Approval' then 'Your demand has been sent to the department head for approval.'
      when 'Approved' then format('Approved for %s.', new.approved_quantity)
      when 'Partially Approved' then format('Approved for %s of %s: %s', new.approved_quantity,
                                            new.quantity, coalesce(v_comment, ''))
      when 'Rejected' then 'Rejected: ' || coalesce(v_comment, '')
      else format('Your demand is now %s.', new.status)
    end,
    new.id);

  if new.status = 'Cancelled' and v_actor = new.requested_by_person_id then
    perform it.notify_demand_processors(new.site_id, 'demand_cancelled',
      format('Demand %s cancelled by the requester', new.demand_number),
      new.cancellation_reason, new.id);
  end if;
  return null;
end;
$$;

-- ===========================================================================
-- PART D — Cancel while Pending Approval (replaces javaria_it_0010's trigger function; only the
-- cancel rule changed: site procurement may also cancel Pending Approval).
-- ===========================================================================

create or replace function it.demands_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_owner boolean;
  v_process boolean;
  v_price numeric(12, 2);
  v_active boolean;
  v_consumable_path boolean;
begin
  if v_actor is null or coalesce(current_setting('it.demand_system', true), '') = 'on' then
    return new;
  end if;

  new.demand_number := old.demand_number;
  new.requested_by_person_id := old.requested_by_person_id;
  new.company_id := old.company_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.vendor_id := old.vendor_id;
  new.approved_quantity := old.approved_quantity;
  new.deleted_at := old.deleted_at;
  new.categorized_at := old.categorized_at;
  new.categorized_by := old.categorized_by;
  new.stock_updated_at := old.stock_updated_at;
  new.stock_updated_by := old.stock_updated_by;
  new.closed_at := old.closed_at;
  new.cancelled_at := old.cancelled_at;
  new.cancelled_by := old.cancelled_by;

  if old.status in ('Closed', 'Cancelled') then
    raise exception 'Demand % is % and can''t be changed', old.demand_number, lower(old.status);
  end if;

  v_owner := old.requested_by_person_id = v_actor;
  v_process := it.can_process_demand(old.site_id);

  if new.product_id is distinct from old.product_id
     or new.quantity is distinct from old.quantity
     or new.justification is distinct from old.justification
     or new.department_id is distinct from old.department_id
     or new.site_id is distinct from old.site_id then
    if old.status <> 'Open' then
      raise exception 'Only an Open demand can be edited';
    end if;
    if not (v_owner or v_process) then
      raise exception 'You can''t edit this demand';
    end if;
    if new.site_id is distinct from old.site_id then
      if not has_permission('it.demands.read_all') then
        raise exception 'Only all-sites procurement staff can move a demand to another site';
      end if;
      perform it.check_org_unit(new.site_id, 'Site', 'site');
    end if;
    if new.department_id is distinct from old.department_id then
      perform it.check_org_unit(new.department_id, 'Department', 'department');
    end if;
    if new.product_id is distinct from old.product_id then
      select is_active, coalesce(current_price, purchase_price) into v_active, v_price
      from it.products where id = new.product_id;
      if not coalesce(v_active, false) then
        raise exception 'Please choose an active product from the Product Master';
      end if;
      new.estimated_unit_price := v_price;
    else
      new.estimated_unit_price := old.estimated_unit_price;
    end if;
    new.justification := trim(new.justification);
  else
    new.estimated_unit_price := old.estimated_unit_price;
  end if;

  if new.demand_category is distinct from old.demand_category then
    if not v_process then
      raise exception 'Only the site''s procurement staff can categorise a demand';
    end if;
    if old.status not in ('Open', 'Categorized') then
      raise exception 'The category can''t change once the demand has moved on';
    end if;
    if new.demand_category is null then
      raise exception 'Please choose a category';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'Categorized' and old.status = 'Open' then
      if not v_process then
        raise exception 'Only the site''s procurement staff can categorise a demand';
      end if;
      if new.demand_category is null then
        raise exception 'Please choose a category';
      end if;
      new.categorized_at := now();
      new.categorized_by := v_actor;

    elsif new.status = 'Cancelled' then
      if not ((v_owner and old.status = 'Open')
              or (v_process and old.status in ('Open', 'Categorized', 'Pending Approval'))) then
        raise exception 'This demand can''t be cancelled at this stage';
      end if;
      if coalesce(trim(new.cancellation_reason), '') = '' then
        raise exception 'Please give a reason for cancelling';
      end if;
      new.cancellation_reason := trim(new.cancellation_reason);
      new.cancelled_at := now();
      new.cancelled_by := v_actor;

    elsif new.status = 'Stock Updated' and old.status = 'Categorized' then
      select consumable_path_enabled into v_consumable_path from it.procurement_settings where id;
      if not v_process then
        raise exception 'Only the site''s procurement staff can record the stock entry';
      end if;
      if new.demand_category is distinct from 'Consumable' or not coalesce(v_consumable_path, false) then
        raise exception 'Only consumable demands skip approval (and only when the consumable path is enabled)';
      end if;
      if coalesce(trim(new.stock_note), '') = '' then
        raise exception 'Please note what was issued from stock';
      end if;
      new.stock_note := trim(new.stock_note);
      new.stock_updated_at := now();
      new.stock_updated_by := v_actor;

    elsif new.status = 'Closed' and old.status = 'Stock Updated' then
      if not v_process then
        raise exception 'Only the site''s procurement staff can close a demand';
      end if;
      new.closed_at := now();

    else
      raise exception 'A demand can''t move from % to % here', old.status, new.status;
    end if;
  else
    new.stock_note := old.stock_note;
    new.cancellation_reason := old.cancellation_reason;
  end if;

  new.updated_by := v_actor;
  return new;
end;
$$;

-- ===========================================================================
-- PART E — Row Level Security.
-- ===========================================================================

alter table it.department_approvers enable row level security;
alter table it.demand_approvals enable row level security;

create policy "department_approvers readable by procurement" on it.department_approvers
  for select to authenticated using (it.can_read_procurement_masters());
create policy "department_approvers write by procurement settings" on it.department_approvers
  for all to authenticated
  using (has_permission('it.procurement_settings.update'))
  with check (has_permission('it.procurement_settings.update'));

grant select, insert, update, delete on it.department_approvers to authenticated;

-- Decisions are written only by it.decide_demand(); readable with the demand.
create policy "demand_approvals readable with the demand" on it.demand_approvals
  for select to authenticated
  using (exists (select 1 from it.demands d where d.id = demand_id));

revoke insert, update, delete on it.demand_approvals from authenticated;
grant select on it.demand_approvals to authenticated;

-- Approvers see their departments' demands from the moment they're sent for approval.
drop policy "demands select own or site staff" on it.demands;
create policy "demands select own, site staff or approver" on it.demands
  for select to authenticated
  using (deleted_at is null
         and (requested_by_person_id = current_person_id()
              or it.can_see_site_demands(site_id)
              or (status not in ('Open', 'Categorized') and it.is_demand_approver(department_id))));

drop policy "demand_updates select" on it.demand_updates;
create policy "demand_updates select" on it.demand_updates
  for select to authenticated
  using (exists (
    select 1 from it.demands d
    where d.id = demand_id
      and (
        it.can_see_site_demands(d.site_id)
        or (not is_internal
            and (d.requested_by_person_id = current_person_id()
                 or (d.status not in ('Open', 'Categorized') and it.is_demand_approver(d.department_id))))
      )
  ));

drop policy "demand_updates insert comments" on it.demand_updates;
create policy "demand_updates insert comments" on it.demand_updates
  for insert to authenticated
  with check (
    author_person_id = current_person_id()
    and update_type in ('comment', 'work_note')
    and exists (
      select 1 from it.demands d
      where d.id = demand_id
        and (
          it.can_see_site_demands(d.site_id)
          or (not is_internal
              and (d.requested_by_person_id = current_person_id()
                   or (d.status not in ('Open', 'Categorized') and it.is_demand_approver(d.department_id))))
        )
    )
  );

-- Names: approvers resolve people too.
create or replace function it.demand_person_names(p_person_ids uuid[])
returns table (person_id uuid, full_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name
  from persons p
  where p.id = any (p_person_ids)
    and (
      has_permission('it.demands.read')
      or has_permission('it.demands.read_all')
      or has_permission('it.demands.approve')
      or p.id = current_person_id()
      or exists (
        select 1 from it.demands d
        where d.requested_by_person_id = current_person_id()
          and (
            p.id in (d.categorized_by, d.cancelled_by, d.stock_updated_by, d.updated_by)
            or exists (select 1 from it.demand_approvals a
                       where a.demand_id = d.id and a.approver_person_id = p.id)
            or exists (
              select 1 from it.demand_updates u
              where u.demand_id = d.id and u.author_person_id = p.id and not u.is_internal
            )
          )
      )
    );
$$;

-- ===========================================================================
-- PART F — Permission.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.demands.approve', 'it', 'Approve Demands',
   'Approve, partially approve or reject demands — only for departments you''re mapped to as approver')
on conflict (key) do nothing;

-- Admin / IT Admin get it so the flow can be tested; department heads get it through their role.
insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
from roles r
join permissions p on p.key = 'it.demands.approve'
where r.name in ('Admin', 'IT Admin')
on conflict do nothing;
