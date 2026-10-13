-- Employee Portal — IT module (M2) foundation: schema grants, a shared reference-number
-- generator, and module:it itself. Replicated into the main sequence from
-- supabase/it-migrations/talha/talha_it_0001_foundation.sql (Talha, it/talha) — confirmed
-- already live via direct inspection when IT/dev was reconciled (information_schema +
-- pg_proc + permissions/role_permissions checks), not re-run here.
--
-- module:it's insert below is a confirmed no-op on a fresh apply: 0021_module_it_permission.sql
-- already seeds that exact key (with a shorter description — mine ran first in this app's own
-- history) and `on conflict (key) do nothing` makes this safe regardless of which one runs
-- first. Kept here, unedited, for historical fidelity to what Talha's branch actually contains.
--
-- Also required, and NOT doable in SQL: add `it` to Supabase's Exposed Schemas list (Project
-- Settings → API → Exposed schemas) before any app code calls `.schema("it")`. Same caveat as
-- 0012_hr_module.sql's header.

-- ---------------------------------------------------------------------------
-- Schema grants — mirrors 0012. A schema created outside `public` has none of public's default
-- grants; without these, `authenticated` can't reach it.* tables and RLS never gets evaluated.
-- `anon` deliberately gets nothing. Default privileges only cover tables created *after* this
-- line by this same role, so every later IT migration still ends with its own concrete grant.
-- ---------------------------------------------------------------------------

grant usage on schema it to authenticated;
alter default privileges in schema it
  grant select, insert, update, delete on tables to authenticated;

-- ---------------------------------------------------------------------------
-- Human-readable reference numbers (ONB-000123, OFB-000512, DMD-004821, ticket numbers, asset
-- tags). One counter row per prefix, incremented under a row lock by the upsert, so two
-- concurrent callers can never get the same number. The table is only ever touched through the
-- function: RLS on, no policies, no direct grants.
-- ---------------------------------------------------------------------------

create table if not exists it.number_sequences (
  prefix text primary key,
  last_value bigint not null default 0
);

alter table it.number_sequences enable row level security;
revoke all on it.number_sequences from authenticated;

create or replace function it.next_number(p_prefix text, p_width int default 6)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  insert into it.number_sequences as s (prefix, last_value)
  values (p_prefix, 1)
  on conflict (prefix) do update set last_value = s.last_value + 1
  returning s.last_value into v_next;

  return p_prefix || '-' || lpad(v_next::text, p_width, '0');
end;
$$;

revoke all on function it.next_number(text, int) from public;
grant execute on function it.next_number(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Module registration (SOP §11 step 4). module:it is the coarse route-boundary gate and needs
-- senior-dev sign-off; granting it to the base Employee role here is that sign-off, the same
-- way 0012 did for module:hr — every employee needs My Assets and to raise tickets.
-- it.manage_role_permissions gates /it/admin/roles (shared by both IT tracks).
-- `label` is required since 0020_permission_labels.sql.
-- ---------------------------------------------------------------------------

insert into permissions (key, module, label, description) values
  ('module:it', 'it', 'IT', 'Open the IT module (my assets, IT tickets, demands)'),
  ('it.manage_role_permissions', 'it', 'IT Role Permissions', 'Configure which portal role has which IT permission')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id, granted_by)
select r.id, p.id, null
from roles r, permissions p
where (r.name = 'Employee' and p.key = 'module:it')
   or (r.name = 'Admin' and p.key in ('module:it', 'it.manage_role_permissions'))
on conflict do nothing;
