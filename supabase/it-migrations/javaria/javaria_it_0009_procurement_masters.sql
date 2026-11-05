-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Procurement Phase 1 — Vendor & product masters (09-it-procurement-plan.md §5)
-- Depends on:  talha_it_0001_foundation.sql / 0024 (grants, it schema);
--              talha_it_0002 / 0026 (it.asset_types)
-- Applied to live DB: YES (confirmed live 2026-10-23 by read-only check)
--
-- ERD v4 section D: vendors, products (+ accepted addition #5 products.asset_type_id), and the
-- procurement settings row (plan addition P4). These unblock Talha:
--   * it.products → his stock_movements.product_id FK (his Phase 5)
--   * it.vendors  → his assets.vendor_id / asset_maintenance.vendor_id FKs (his Phase 7)
-- He adds those FKs in his own linking migration once this is applied (07 §2.1).
--
-- Rules
--   * Nothing is deleted: vendors and products are deactivated (is_active = false), because
--     demands, assets and repairs will keep pointing at them.
--   * Names are unique ignoring case, so "HP" and "hp" can't be two vendors.
--   * A product with asset_type_id is a FIXED-ASSET product (receiving it will register assets);
--     without one it's a CONSUMABLE / service (receiving it adds stock).
--   * Every insert / update is written to public.audit_log (module 'it') by a security-definer
--     trigger — the table itself only accepts inserts from full admins.
--   * Readable by procurement staff and by inventory staff (Talha's screens show vendor names);
--     writable with it.vendors.update / it.products.update.

-- ===========================================================================
-- PART A — Tables.
-- ===========================================================================

create table it.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null check (length(trim(vendor_name)) > 0),
  contact_person text,
  contact_no text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text,
  tax_number text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  updated_by uuid references public.persons(id) on delete set null
);

create unique index vendors_name_unique on it.vendors (lower(trim(vendor_name)));

create table it.products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (length(trim(product_name)) > 0),
  category text,
  unit text not null default 'Each' check (length(trim(unit)) > 0),
  purchase_price numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  current_price numeric(12, 2) check (current_price is null or current_price >= 0),
  description text,
  -- Accepted addition #5 (07 §1.3): set = fixed-asset product (Talha's asset types).
  asset_type_id uuid references it.asset_types(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id) on delete set null,
  updated_by uuid references public.persons(id) on delete set null
);

create unique index products_name_unique on it.products (lower(trim(product_name)));
create index products_asset_type_idx on it.products (asset_type_id);

-- Plan addition P4: one row of procurement settings, used from Phase 5 / 6 onwards.
create table it.procurement_settings (
  id boolean primary key default true check (id),
  finance_sla_days int not null default 5 check (finance_sla_days between 1 and 90),
  reminder_interval_days int not null default 2 check (reminder_interval_days between 1 and 30),
  invoice_tolerance_pct numeric(5, 2) not null default 1.00
    check (invoice_tolerance_pct between 0 and 20),
  consumable_path_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.persons(id) on delete set null
);

insert into it.procurement_settings (id) values (true) on conflict do nothing;

create trigger vendors_set_updated_at
  before update on it.vendors
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at
  before update on it.products
  for each row execute function public.set_updated_at();
create trigger procurement_settings_set_updated_at
  before update on it.procurement_settings
  for each row execute function public.set_updated_at();

-- Who created / last changed a row comes from the session, never the client.
create function it.set_master_audit_columns()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := public.current_person_id();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(v_actor, new.updated_by);
  return new;
end;
$$;

create trigger trg_vendors_audit_columns
  before insert or update on it.vendors
  for each row execute function it.set_master_audit_columns();
create trigger trg_products_audit_columns
  before insert or update on it.products
  for each row execute function it.set_master_audit_columns();

-- Audit trail in public.audit_log (security definer: that table only takes admin inserts).
create function it.log_master_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := current_person_id();
  v_name text;
  v_what text;
begin
  if tg_table_name = 'vendors' then
    v_name := new.vendor_name;
    v_what := 'vendor';
  else
    v_name := new.product_name;
    v_what := 'product';
  end if;

  insert into audit_log (actor_id, actor_label, module, action, details)
  values (
    v_actor,
    coalesce((select full_name from persons where id = v_actor), 'System'),
    'it',
    case when tg_op = 'INSERT' then 'CREATED' else 'MODIFIED' end,
    case
      when tg_op = 'INSERT' then format('Added %s ''%s''', v_what, v_name)
      when old.is_active and not new.is_active then format('Deactivated %s ''%s''', v_what, v_name)
      when not old.is_active and new.is_active then format('Reactivated %s ''%s''', v_what, v_name)
      else format('Edited %s ''%s''', v_what, v_name)
    end
  );
  return null;
end;
$$;

create trigger trg_vendors_audit_log
  after insert or update on it.vendors
  for each row execute function it.log_master_change();
create trigger trg_products_audit_log
  after insert or update on it.products
  for each row execute function it.log_master_change();

-- ===========================================================================
-- PART B — Row Level Security.
-- ===========================================================================

-- Who may read the masters: procurement roles (this track, later phases too) and inventory staff
-- (Talha's asset / repair screens show vendor names). Plain employees don't see vendor contacts.
create function it.can_read_procurement_masters()
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
      or has_permission('it.payments.update')
      or has_permission('it.assets.read');
$$;

revoke all on function it.can_read_procurement_masters() from public;
grant execute on function it.can_read_procurement_masters() to authenticated;
revoke all on function it.log_master_change() from public;

alter table it.vendors enable row level security;
alter table it.products enable row level security;
alter table it.procurement_settings enable row level security;

create policy "vendors readable by procurement and inventory staff" on it.vendors
  for select to authenticated using (it.can_read_procurement_masters());
create policy "vendors insert by vendor managers" on it.vendors
  for insert to authenticated with check (has_permission('it.vendors.update'));
create policy "vendors update by vendor managers" on it.vendors
  for update to authenticated
  using (has_permission('it.vendors.update'))
  with check (has_permission('it.vendors.update'));

create policy "products readable by procurement and inventory staff" on it.products
  for select to authenticated using (it.can_read_procurement_masters());
create policy "products insert by product managers" on it.products
  for insert to authenticated with check (has_permission('it.products.update'));
create policy "products update by product managers" on it.products
  for update to authenticated
  using (has_permission('it.products.update'))
  with check (has_permission('it.products.update'));

create policy "procurement_settings readable by procurement staff" on it.procurement_settings
  for select to authenticated using (it.can_read_procurement_masters());
create policy "procurement_settings update by settings admin" on it.procurement_settings
  for update to authenticated
  using (has_permission('it.procurement_settings.update'))
  with check (has_permission('it.procurement_settings.update'));

-- No delete for anyone: deactivate instead.
grant select, insert, update on it.vendors, it.products to authenticated;
grant select, update on it.procurement_settings to authenticated;
grant select on it.vendors, it.products to service_role;

-- ===========================================================================
-- PART C — Permissions (Phase 1 keys only; later phases add the demand / invoice / payment keys).
-- Granted to Admin and the IT Admin role; everyone else via IT Roles & Permissions.
-- ===========================================================================

insert into permissions (key, module, label, description) values
  ('it.vendors.update', 'it', 'Manage Vendors',
   'Add, edit and deactivate vendors in the Vendor Master (contact person, phone, email, address, tax number)'),
  ('it.products.update', 'it', 'Manage Products',
   'Add, edit and deactivate products in the Product Master (category, unit, prices, asset type link)'),
  ('it.procurement_settings.update', 'it', 'Procurement Settings',
   'Finance SLA, reminder interval, invoice tolerance and other procurement settings')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null::uuid
from roles r
join permissions p on p.key in (
  'it.vendors.update', 'it.products.update', 'it.procurement_settings.update'
)
where r.name in ('Admin', 'IT Admin')
on conflict do nothing;
