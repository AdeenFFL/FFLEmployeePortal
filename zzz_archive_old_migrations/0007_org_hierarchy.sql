-- Employee Portal — Org hierarchy: companies (Fauji Food has multiple sub-companies/brands,
-- each with multiple sites — org_units alone can't express that level).
-- Purely additive: no changes to any table, policy, or function from 0001-0006.

create table companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

alter table companies enable row level security;

create policy "companies readable by authenticated" on companies
  for select to authenticated using (true);

create policy "companies admin access" on companies
  for insert to authenticated with check (is_admin(auth.uid()));

create policy "companies admin update" on companies
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Sites belong to a company; shared/central departments can stay unassigned (null).
alter table org_units
  add column company_id uuid references companies(id),
  add column site_type text check (site_type in ('plant','warehouse','shop','head_office','mess','other'));

-- Seed placeholder — replace with real sub-company data before go-live.
insert into companies (code, name) values
  ('FFL', 'Fauji Foods Limited')
on conflict do nothing;
