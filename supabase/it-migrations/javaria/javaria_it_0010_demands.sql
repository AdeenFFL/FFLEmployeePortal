-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 2 — Demands, categorisation and the consumable path
--              (09-it-procurement-plan.md §5 Phase 2; BRD §5.5.1–5.5.3)
-- Depends on:  javaria_it_0003_notifications.sql (it.notifications), javaria_it_0005_site_routing.sql
--              (it.site_it_staff, it.is_site_member, it.hq_site_id),
--              javaria_it_0009_procurement_masters.sql (it.products, it.procurement_settings)
-- Applied to live DB: YES (confirmed live 2026-10-23 by read-only check)
--
-- What this does
--   * it.demands — a purchase demand raised by Site Support (DMD-000123), for one product from the
--     master, with department, site, quantity and justification. Status, category, vendor and
--     approved quantity are workflow fields: never taken from the client.
--   * it.demand_updates — the per-demand timeline (plan addition P2): raised, edits, category,
--     status changes, comments (public or internal).
--   * Site scoping like tickets (P5): site IT staff (it.site_it_staff) with it.demands.read see their
--     site's demands, it.demands.read_all sees every site, a requester always sees their own.
--   * Workflow (enforced by trigger):
--       Open → Categorized                 procurement staff of the site (it.demands.update)
--       Categorized → Stock Updated → Closed   consumable path (category Consumable, enabled in
--                                          procurement settings) — BRD §5.5.3
--       Open | Categorized → Cancelled     requester while Open; staff while Open / Categorized
--     Every later status (Pending Approval, Approved, … Invoicing) is reached only through the
--     security-definer functions of Phases 3–6 (session flag it.demand_system = 'on').
--   * Consumable stock entry: Talha's recordStockMovement() isn't built yet (07 Phase 5), so
--     "Stock Updated" is recorded by hand with a note (plan §2 interim). Switch to his function
--     when it ships.
--   * Notifications: new demand → the site's procurement staff (fallback: all-sites procurement
--     staff); status changes → requester; comments → the other side.

-- ===========================================================================
-- PART A — Tables.
-- ===========================================================================

create table it.demands (
  id uuid primary key default gen_random_uuid(),
  demand_number text not null unique default it.next_number('DMD'),

  product_id uuid not null references it.products(id),
  requested_by_person_id uuid not null references public.persons(id),
  department_id uuid not null references public.org_units(id),
  site_id uuid not null references public.org_units(id),
  company_id uuid references public.companies(id),
  quantity int not null check (quantity > 0 and quantity <= 100000),
  justification text not null check (length(trim(justification)) > 0),
  -- Snapshot of the product's price when raised (current, else purchase price).
  estimated_unit_price numeric(12, 2),

  status text not null default 'Open' check (status in (
    'Open', 'Categorized', 'Pending Approval', 'Approved', 'Partially Approved', 'Rejected',
    'Assigned to Vendor', 'Partially Received', 'Received', 'Invoicing', 'Stock Updated',
    'Closed', 'Cancelled'
  )),
  -- BRD §5.5.2. "Open" = general purchase until the BA defines it (plan §8 #8).
  demand_category text check (demand_category in ('Consumable', 'Open', 'Repair', 'Maintenance', 'Fix')),
  categorized_at timestamptz,
  categorized_by uuid references public.persons(id),

  -- Filled by later phases (approval, vendor assignment) — read-only here.
  vendor_id uuid references it.vendors(id),
  approved_quantity int check (approved_quantity is null or approved_quantity >= 0),

  -- Consumable path (§5.5.3).
  stock_note text,
  stock_updated_at timestamptz,
  stock_updated_by uuid references public.persons(id),

  closed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.persons(id),
  cancellation_reason text,

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create index demands_requester_idx on it.demands (requested_by_person_id);
create index demands_site_status_idx on it.demands (site_id, status);
create index demands_product_idx on it.demands (product_id);
create index demands_created_at_idx on it.demands (created_at desc);

create trigger demands_set_updated_at
  before update on it.demands
  for each row execute function public.set_updated_at();

create table it.demand_updates (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references it.demands(id) on delete cascade,
  author_person_id uuid references public.persons(id),
  update_type text not null default 'comment' check (update_type in (
    'comment', 'work_note', 'created', 'edit', 'category_change', 'status_change', 'system'
  )),
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint demand_updates_work_note_internal check (update_type <> 'work_note' or is_internal)
);

create index demand_updates_demand_idx on it.demand_updates (demand_id, created_at);

alter table it.notifications
  add column demand_id uuid references it.demands(id) on delete cascade;

-- ===========================================================================
-- PART B — Scope helpers (security definer: callable from policies without RLS recursion).
-- ===========================================================================

-- Staff-level visibility of a site's demands (incl. internal notes).
create function it.can_see_site_demands(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.demands.read_all')
      or (has_permission('it.demands.read') and p_site_id is not null and it.is_site_member(p_site_id));
$$;

-- May categorise / process / cancel a site's demands.
create function it.can_process_demand(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_permission('it.demands.update')
     and (has_permission('it.demands.read_all')
          or (p_site_id is not null and it.is_site_member(p_site_id)));
$$;

-- Org unit of the expected type and active (org_units itself is admin-only under RLS).
create function it.check_org_unit(p_id uuid, p_type text, p_label text)
returns void
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from org_units where id = p_id and type = p_type and is_active) then
    raise exception 'Please choose an active %', p_label;
  end if;
end;
$$;

-- Who processes a site's demands: its IT staff holding it.demands.update; if the site has none,
-- everyone with it.demands.update + it.demands.read_all (HQ procurement).
create function it.demand_processors(p_site_id uuid)
returns table (person_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  with holders as (
    select distinct ur.person_id, perm.key
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions perm on perm.id = rp.permission_id
    where perm.key in ('it.demands.update', 'it.demands.read_all')
  ),
  site_team as (
    select s.person_id
    from it.site_it_staff s
    where s.site_id = p_site_id
      and exists (select 1 from holders h where h.person_id = s.person_id and h.key = 'it.demands.update')
  )
  select person_id from site_team
  union
  select h.person_id
  from holders h
  where h.key = 'it.demands.update'
    and not exists (select 1 from site_team)
    and exists (select 1 from holders h2 where h2.person_id = h.person_id and h2.key = 'it.demands.read_all');
$$;

revoke all on function it.can_see_site_demands(uuid) from public;
revoke all on function it.can_process_demand(uuid) from public;
revoke all on function it.check_org_unit(uuid, text, text) from public;
revoke all on function it.demand_processors(uuid) from public;
grant execute on function it.can_see_site_demands(uuid) to authenticated;
grant execute on function it.can_process_demand(uuid) to authenticated;

-- ===========================================================================
-- PART C — Workflow rules.
-- `it.demand_system` = 'on' marks trusted updates from later phases' security-definer functions.
-- current_person_id() is null for service-role / SQL-editor sessions, which skip the gates.
-- ===========================================================================

-- New demands always start clean: the requester chooses the content, never the workflow fields.
create function it.demands_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_company uuid;
  v_home_site uuid;
  v_price numeric(12, 2);
  v_active boolean;
begin
  new.requested_by_person_id := coalesce(v_actor, new.requested_by_person_id);
  if new.requested_by_person_id is null then
    raise exception 'A demand needs a requester';
  end if;

  select company_id, site_id into v_company, v_home_site
  from persons where id = new.requested_by_person_id;

  new.company_id := v_company;
  new.site_id := coalesce(new.site_id, v_home_site, it.hq_site_id());
  if new.site_id is null then
    raise exception 'Please choose the site this demand is for';
  end if;
  perform it.check_org_unit(new.site_id, 'Site', 'site');
  perform it.check_org_unit(new.department_id, 'Department', 'department');

  -- Your own site, a site whose IT team you're on, or any site with read_all.
  if v_actor is not null
     and new.site_id is distinct from v_home_site
     and not has_permission('it.demands.read_all')
     and not it.is_site_member(new.site_id) then
    raise exception 'You can only raise demands for your own site';
  end if;

  select is_active, coalesce(current_price, purchase_price) into v_active, v_price
  from it.products where id = new.product_id;
  if not coalesce(v_active, false) then
    raise exception 'Please choose an active product from the Product Master';
  end if;

  new.justification := trim(new.justification);
  new.estimated_unit_price := v_price;
  new.status := 'Open';
  new.demand_category := null;
  new.categorized_at := null;
  new.categorized_by := null;
  new.vendor_id := null;
  new.approved_quantity := null;
  new.stock_note := null;
  new.stock_updated_at := null;
  new.stock_updated_by := null;
  new.closed_at := null;
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.cancellation_reason := null;
  new.deleted_at := null;
  new.created_at := now();
  new.created_by := new.requested_by_person_id;
  new.updated_by := new.requested_by_person_id;
  return new;
end;
$$;

create trigger trg_demands_before_insert
  before insert on it.demands
  for each row execute function it.demands_before_insert();

create function it.demands_before_update()
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

  -- Never changed from a screen.
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

  -- Content: only while Open, by the requester or the site's procurement staff.
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

  -- Category (BRD §5.5.2): procurement staff, before the demand goes for approval.
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
              or (v_process and old.status in ('Open', 'Categorized'))) then
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
    -- Notes only change together with their step.
    new.stock_note := old.stock_note;
    new.cancellation_reason := old.cancellation_reason;
  end if;

  new.updated_by := v_actor;
  return new;
end;
$$;

create trigger trg_demands_before_update
  before update on it.demands
  for each row execute function it.demands_before_update();

-- ===========================================================================
-- PART D — Timeline (security definer: the change was authorised by RLS + the trigger above;
-- the actor may not pass demand_updates' insert policy, which is for comments only).
-- ===========================================================================

create function it.log_demand_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into it.demand_updates (demand_id, author_person_id, update_type, body)
  values (new.id, new.requested_by_person_id, 'created',
          format('Demand raised: %s × %s', new.quantity,
                 (select product_name from it.products where id = new.product_id)));
  return null;
end;
$$;

create trigger trg_log_demand_insert
  after insert on it.demands
  for each row execute function it.log_demand_insert();

create function it.log_demand_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_changes text[] := '{}';
begin
  if new.product_id is distinct from old.product_id then
    v_changes := v_changes || format('product → %s',
      (select product_name from it.products where id = new.product_id));
  end if;
  if new.quantity is distinct from old.quantity then
    v_changes := v_changes || format('quantity %s → %s', old.quantity, new.quantity);
  end if;
  if new.department_id is distinct from old.department_id then
    v_changes := v_changes || format('department → %s',
      (select name from org_units where id = new.department_id));
  end if;
  if new.site_id is distinct from old.site_id then
    v_changes := v_changes || format('site → %s', (select name from org_units where id = new.site_id));
  end if;
  if new.justification is distinct from old.justification then
    v_changes := v_changes || 'justification updated'::text;
  end if;
  if array_length(v_changes, 1) > 0 then
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'edit', 'Edited: ' || array_to_string(v_changes, '; '));
  end if;

  if new.demand_category is distinct from old.demand_category then
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'category_change',
            case when old.demand_category is null
                 then format('Categorised as %s', new.demand_category)
                 else format('Category changed from %s to %s', old.demand_category, new.demand_category)
            end);
  end if;

  if new.vendor_id is distinct from old.vendor_id and new.vendor_id is not null then
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'system',
            format('Vendor: %s', (select vendor_name from it.vendors where id = new.vendor_id)));
  end if;

  if new.status is distinct from old.status then
    insert into it.demand_updates (demand_id, author_person_id, update_type, body)
    values (new.id, v_actor, 'status_change',
            format('Status changed from %s to %s', old.status, new.status)
            || case
                 when new.status = 'Cancelled' then ' — ' || new.cancellation_reason
                 when new.status = 'Stock Updated' then ' — ' || new.stock_note
                 else ''
               end);
  end if;

  return null;
end;
$$;

create trigger trg_log_demand_changes
  after update on it.demands
  for each row execute function it.log_demand_changes();

revoke all on function it.log_demand_insert() from public;
revoke all on function it.log_demand_changes() from public;

-- ===========================================================================
-- PART E — Notifications (same rules as tickets: written by triggers only; the actor never
-- notifies themselves except the requester's own acknowledgement).
-- ===========================================================================

create function it.notify_demand_person(
  p_recipient uuid,
  p_event text,
  p_title text,
  p_body text,
  p_demand_id uuid,
  p_include_actor boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  if not p_include_actor and p_recipient = current_person_id() then
    return;
  end if;
  if not exists (
    select 1 from persons p
    join user_accounts ua on ua.person_id = p.id
    where p.id = p_recipient and p.status = 'Active' and ua.status = 'Active'
  ) then
    return;
  end if;

  insert into it.notifications (recipient_person_id, event, title, body, link, demand_id)
  values (p_recipient, p_event, p_title, left(p_body, 500),
          '/it/procurement/demands/' || p_demand_id, p_demand_id);
end;
$$;

create function it.notify_demand_processors(
  p_site_id uuid,
  p_event text,
  p_title text,
  p_body text,
  p_demand_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person uuid;
begin
  for v_person in select person_id from it.demand_processors(p_site_id) loop
    perform it.notify_demand_person(v_person, p_event, p_title, p_body, p_demand_id);
  end loop;
end;
$$;

create function it.notify_demand_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product text := (select product_name from it.products where id = new.product_id);
begin
  perform it.notify_demand_person(new.requested_by_person_id, 'demand_created',
    format('Demand %s received', new.demand_number),
    format('Your demand for %s × %s has been logged. Procurement will review it.', new.quantity, v_product),
    new.id, true);

  perform it.notify_demand_processors(new.site_id, 'demand_new',
    format('New demand %s', new.demand_number),
    format('%s requested %s × %s at %s.',
           coalesce((select full_name from persons where id = new.requested_by_person_id), 'Someone'),
           new.quantity, v_product, (select name from org_units where id = new.site_id)),
    new.id);
  return null;
end;
$$;

create trigger trg_notify_demand_insert
  after insert on it.demands
  for each row execute function it.notify_demand_insert();

create function it.notify_demand_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  perform it.notify_demand_person(new.requested_by_person_id, 'demand_status',
    format('Demand %s: %s', new.demand_number, new.status),
    case new.status
      when 'Cancelled' then 'Cancelled: ' || coalesce(new.cancellation_reason, '')
      when 'Stock Updated' then 'Issued from stock: ' || coalesce(new.stock_note, '')
      else format('Your demand is now %s.', new.status)
    end,
    new.id);

  -- The requester cancelled it themselves → tell procurement.
  if new.status = 'Cancelled' and v_actor = new.requested_by_person_id then
    perform it.notify_demand_processors(new.site_id, 'demand_cancelled',
      format('Demand %s cancelled by the requester', new.demand_number),
      new.cancellation_reason, new.id);
  end if;
  return null;
end;
$$;

create trigger trg_notify_demand_update
  after update on it.demands
  for each row execute function it.notify_demand_update();

create function it.notify_demand_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demand it.demands%rowtype;
begin
  if new.update_type not in ('comment', 'work_note') then
    return null;
  end if;
  select * into v_demand from it.demands where id = new.demand_id;

  if new.author_person_id = v_demand.requested_by_person_id then
    perform it.notify_demand_processors(v_demand.site_id, 'demand_comment',
      format('New comment on demand %s', v_demand.demand_number), new.body, v_demand.id);
  elsif not new.is_internal then
    perform it.notify_demand_person(v_demand.requested_by_person_id, 'demand_comment',
      format('Procurement replied on demand %s', v_demand.demand_number), new.body, v_demand.id);
  end if;
  return null;
end;
$$;

create trigger trg_notify_demand_comment
  after insert on it.demand_updates
  for each row execute function it.notify_demand_comment();

revoke all on function it.notify_demand_person(uuid, text, text, text, uuid, boolean) from public;
revoke all on function it.notify_demand_processors(uuid, text, text, text, uuid) from public;

-- ===========================================================================
-- PART F — Row Level Security + names.
-- ===========================================================================

alter table it.demands enable row level security;
alter table it.demand_updates enable row level security;

create policy "demands select own or site staff" on it.demands
  for select to authenticated
  using (deleted_at is null
         and (requested_by_person_id = current_person_id() or it.can_see_site_demands(site_id)));

create policy "demands insert by demand raisers" on it.demands
  for insert to authenticated
  with check (has_permission('it.demands.create')
              and requested_by_person_id = current_person_id());

-- Who may touch a row; WHAT they may change is decided by it.demands_before_update().
create policy "demands update by requester or site procurement" on it.demands
  for update to authenticated
  using (requested_by_person_id = current_person_id() or it.can_process_demand(site_id))
  with check (requested_by_person_id = current_person_id() or it.can_process_demand(site_id)
              or has_permission('it.demands.read_all'));

create policy "demand_updates select" on it.demand_updates
  for select to authenticated
  using (exists (
    select 1 from it.demands d
    where d.id = demand_id
      and (d.requested_by_person_id = current_person_id() or it.can_see_site_demands(d.site_id))
      and (not is_internal or it.can_see_site_demands(d.site_id))
  ));

create policy "demand_updates insert comments" on it.demand_updates
  for insert to authenticated
  with check (
    author_person_id = current_person_id()
    and update_type in ('comment', 'work_note')
    and exists (
      select 1 from it.demands d
      where d.id = demand_id
        and (d.requested_by_person_id = current_person_id() or it.can_see_site_demands(d.site_id))
        and (not is_internal or it.can_see_site_demands(d.site_id))
    )
  );

revoke delete on it.demands from authenticated;
revoke update, delete on it.demand_updates from authenticated;
grant select, insert, update on it.demands to authenticated;
grant select, insert on it.demand_updates to authenticated;

-- Names on demand screens. persons is only readable by the person themself / admins.
-- Procurement staff resolve anyone; a requester resolves people on their own demands.
create function it.demand_person_names(p_person_ids uuid[])
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
      or p.id = current_person_id()
      or exists (
        select 1 from it.demands d
        where d.requested_by_person_id = current_person_id()
          and (
            p.id in (d.categorized_by, d.cancelled_by, d.stock_updated_by, d.updated_by)
            or exists (
              select 1 from it.demand_updates u
              where u.demand_id = d.id and u.author_person_id = p.id and not u.is_internal
            )
          )
      )
    );
$$;

revoke all on function it.demand_person_names(uuid[]) from public;
grant execute on function it.demand_person_names(uuid[]) to authenticated;

-- ===========================================================================
-- PART G — Permissions (it.demands.approve arrives with Phase 3).
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.demands.create', 'it', 'Raise Demands',
   'Raise a purchase demand for a product from the Product Master (Site Support Team)'),
  ('it.demands.read', 'it', 'View Demands',
   'See the demand queue of the sites whose IT team you''re on (own demands are always visible)'),
  ('it.demands.read_all', 'it', 'View All Sites'' Demands',
   'See every site''s demands (HQ procurement, Finance, HOD IT)'),
  ('it.demands.update', 'it', 'Process Demands',
   'Categorise, cancel and process demands for your sites (all sites with View All Sites'' Demands)')
on conflict (key) do nothing;

-- Admin / IT Admin get everything; the seeded IT roles (javaria_it_0008) get a sensible bundle.
-- Roles that don't exist are skipped. Anything else is set on IT Roles & Permissions.
insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
from roles r
join permissions p on (
     (r.name in ('Admin', 'IT Admin')
        and p.key in ('it.demands.create', 'it.demands.read', 'it.demands.read_all', 'it.demands.update'))
  or (r.name = 'IT Executive (HQ)'
        and p.key in ('it.demands.create', 'it.demands.read', 'it.demands.read_all', 'it.demands.update'))
  or (r.name = 'HOD IT' and p.key in ('it.demands.read', 'it.demands.read_all'))
  or (r.name = 'IT Site Manager'
        and p.key in ('it.demands.create', 'it.demands.read', 'it.demands.update'))
  or (r.name = 'IT Team Member' and p.key in ('it.demands.create', 'it.demands.read'))
)
on conflict do nothing;
