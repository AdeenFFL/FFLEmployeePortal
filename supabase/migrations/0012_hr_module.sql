-- Employee Portal — HR module (M1): schema, tables, RLS, permission codes.
-- Design reference: 06-hr-module-design.md. First module to get a real Postgres schema rather
-- than the flat public-schema pattern the base ended up using — see context.md §3's
-- 2026-09-22 entry.
--
-- IMPORTANT — a step this migration CANNOT do: Supabase's PostgREST API only serves schemas on
-- its "Exposed schemas" allow-list (Project Settings → API → Exposed schemas in the Supabase
-- Dashboard, or the equivalent Management API call). `public` is exposed by default; `hr` is
-- not, and there is no SQL statement that adds it — it's project config, not a database object.
-- Add `hr` to that list before any app code tries to query it via supabase-js's
-- `.schema('hr').from(...)`, or every request will 404 regardless of grants/RLS being correct.

create schema hr;

-- ---------------------------------------------------------------------------
-- Schema-level grants. A brand-new schema has NONE of the default grants `public` was already
-- set up with — without this, `authenticated` can't even attempt a query against hr.* tables,
-- and RLS never gets a chance to evaluate. `anon` deliberately gets nothing: all anonymous
-- traffic goes through Server Actions using the service-role client (bypasses grants and RLS
-- entirely), never a direct anon-role query — see Part A below for why.
--
-- `alter default privileges` here only covers tables created by this same role *after* this
-- line runs (i.e. everything below, in this migration) — it does NOT retroactively grant
-- anything on tables that already exist. The mirrored `grant ... on all tables in schema hr`
-- at the very end of this file is the real, concrete grant for the tables this migration
-- actually creates; keep both if a later migration adds more hr.* tables under a different
-- role, since default privileges are per-role, not per-schema.
-- ---------------------------------------------------------------------------

grant usage on schema hr to authenticated;
alter default privileges in schema hr
  grant select, insert, update, delete on tables to authenticated;

-- ===========================================================================
-- PART A — Anonymous feedback chat.
--
-- Genuinely anonymous, no recovery, ever (decided 2026-09-22, see 06-hr-module-design.md §1):
-- no person_id, no IP, no fingerprint stored for the submitter side. The conversation's own id
-- (a cryptographically random v4 UUID) IS the access token — the submitter's browser holds
-- onto it to check for replies. RLS on both tables here stays deny-by-default for anon AND
-- authenticated except the explicit HR-staff policies below; every anonymous submit/read/reply
-- goes through a Server Action using the service-role client, which enforces "you may only
-- touch the conversation whose token you supply" in application code. This is deliberate: the
-- alternative (permissive `using (true)` RLS so an anon-role client could query directly) would
-- let anyone enumerate or bulk-read conversations if the token check were ever done wrong on
-- the client side. Keeping it in one reviewable server-side code path is safer.
-- ===========================================================================

create table hr.anonymous_conversations (
  id uuid primary key default gen_random_uuid(),
  department_org_unit_id uuid not null references public.org_units(id),
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger anonymous_conversations_set_updated_at
  before update on hr.anonymous_conversations
  for each row execute function public.set_updated_at();

create table hr.anonymous_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references hr.anonymous_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('submitter', 'hr')),
  -- Populated only when sender_type = 'hr' — enforced both ways by the trigger below, so an HR
  -- reply can never be misfiled as anonymous and a submitter message can never carry identity.
  sender_person_id uuid references public.persons(id),
  body text not null,
  created_at timestamptz not null default now()
);

create function hr.enforce_anonymous_sender_shape()
returns trigger as $$
begin
  if new.sender_type = 'hr' and new.sender_person_id is null then
    raise exception 'hr replies must carry a sender_person_id';
  end if;
  if new.sender_type = 'submitter' and new.sender_person_id is not null then
    raise exception 'submitter messages must not carry any identity';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_anonymous_sender_shape
  before insert or update on hr.anonymous_messages
  for each row execute function hr.enforce_anonymous_sender_shape();

-- Which HRBP(s) cover which department — HR's own business rule, deliberately not reusing
-- user_roles.site_id/company_id (those are generic identity-layer scoping, not HR-specific).
create table hr.hrbp_departments (
  person_id uuid not null references public.persons(id) on delete cascade,
  department_org_unit_id uuid not null references public.org_units(id) on delete cascade,
  primary key (person_id, department_org_unit_id)
);

alter table hr.anonymous_conversations enable row level security;
alter table hr.anonymous_messages enable row level security;
alter table hr.hrbp_departments enable row level security;

create policy "anonymous_conversations hrbp read own department" on hr.anonymous_conversations
  for select to authenticated using (
    has_permission('hr.manage_anonymous_feedback')
    and exists (
      select 1 from hr.hrbp_departments hd
      where hd.person_id = current_person_id()
        and hd.department_org_unit_id = hr.anonymous_conversations.department_org_unit_id
    )
  );

create policy "anonymous_messages hrbp read own department" on hr.anonymous_messages
  for select to authenticated using (
    exists (
      select 1 from hr.anonymous_conversations c
      join hr.hrbp_departments hd on hd.department_org_unit_id = c.department_org_unit_id
      where c.id = hr.anonymous_messages.conversation_id
        and hd.person_id = current_person_id()
    )
  );

-- HR replies go through this security-definer function rather than a raw insert policy — keeps
-- "must be scoped to your own department" enforced in exactly one place instead of duplicated
-- between RLS and every call site. Mirrors current_person_id()'s security-definer shape.
create function hr.reply_to_anonymous_conversation(p_conversation_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from hr.hrbp_departments hd
    join hr.anonymous_conversations c on c.department_org_unit_id = hd.department_org_unit_id
    where c.id = p_conversation_id and hd.person_id = current_person_id()
  ) then
    raise exception 'Not authorized to reply to this conversation';
  end if;

  insert into hr.anonymous_messages (conversation_id, sender_type, sender_person_id, body)
  values (p_conversation_id, 'hr', current_person_id(), p_body);
end;
$$;

revoke all on function hr.reply_to_anonymous_conversation(uuid, text) from public;
grant execute on function hr.reply_to_anonymous_conversation(uuid, text) to authenticated;

create policy "hrbp_departments hr read own, admin manage" on hr.hrbp_departments
  for select to authenticated using (
    person_id = current_person_id() or has_permission('hr.manage_anonymous_feedback')
  );

create policy "hrbp_departments admin write" on hr.hrbp_departments
  for insert to authenticated with check (has_permission('hr.manage_anonymous_feedback'));

create policy "hrbp_departments admin delete" on hr.hrbp_departments
  for delete to authenticated using (has_permission('hr.manage_anonymous_feedback'));

-- ===========================================================================
-- PART B — Tickets (non-anonymous feedback/requests).
-- ===========================================================================

create table hr.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ticket_categories_set_updated_at
  before update on hr.ticket_categories
  for each row execute function public.set_updated_at();

-- Which HR person/people handle which category — drives auto-assignment.
create table hr.ticket_category_assignees (
  category_id uuid not null references hr.ticket_categories(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  primary key (category_id, person_id)
);

create table hr.tickets (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  category_id uuid references hr.ticket_categories(id),
  subject text not null,
  body text not null,
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Resolved', 'Closed')),
  assigned_to_person_id uuid references public.persons(id),
  -- Denormalized from persons at creation time, per the base SOP's "site/company scoping
  -- column on every transactional table" convention (01-platform-design-and-sop.md §7) — cheap
  -- reporting/filtering by site without a join back through persons on every query.
  company_id uuid references public.companies(id),
  site_id uuid references public.org_units(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create trigger tickets_set_updated_at
  before update on hr.tickets
  for each row execute function public.set_updated_at();

create table hr.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references hr.tickets(id) on delete cascade,
  sender_person_id uuid not null references public.persons(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table hr.ticket_categories enable row level security;
alter table hr.ticket_category_assignees enable row level security;
alter table hr.tickets enable row level security;
alter table hr.ticket_messages enable row level security;

create policy "ticket_categories readable by authenticated" on hr.ticket_categories
  for select to authenticated using (true);

create policy "ticket_categories write by hr admin" on hr.ticket_categories
  for all to authenticated
  using (has_permission('hr.manage_categories')) with check (has_permission('hr.manage_categories'));

create policy "ticket_category_assignees readable by authenticated" on hr.ticket_category_assignees
  for select to authenticated using (true);

create policy "ticket_category_assignees write by hr admin" on hr.ticket_category_assignees
  for all to authenticated
  using (has_permission('hr.manage_categories')) with check (has_permission('hr.manage_categories'));

create policy "tickets select own or hr staff" on hr.tickets
  for select to authenticated using (
    person_id = current_person_id() or has_permission('hr.manage_tickets')
  );

create policy "tickets insert own" on hr.tickets
  for insert to authenticated with check (person_id = current_person_id());

create policy "tickets update by hr staff" on hr.tickets
  for update to authenticated
  using (has_permission('hr.manage_tickets')) with check (has_permission('hr.manage_tickets'));

create policy "ticket_messages select own ticket or hr staff" on hr.ticket_messages
  for select to authenticated using (
    has_permission('hr.manage_tickets')
    or exists (select 1 from hr.tickets t where t.id = ticket_id and t.person_id = current_person_id())
  );

create policy "ticket_messages insert own ticket or hr staff" on hr.ticket_messages
  for insert to authenticated with check (
    sender_person_id = current_person_id()
    and (
      has_permission('hr.manage_tickets')
      or exists (select 1 from hr.tickets t where t.id = ticket_id and t.person_id = current_person_id())
    )
  );

-- Concrete grant for the tables just created (the `alter default privileges` above only covers
-- tables created after it within this same migration, which is everything here, but this is
-- the actual belt to that suspenders — see the comment at the top of this file).
grant select, insert, update, delete on all tables in schema hr to authenticated;

-- ===========================================================================
-- PART C — Permission codes (01-platform-design-and-sop.md §11 step 4).
--
-- `module:hr` needs core-team sign-off since it gates the route boundary — granting it to the
-- base Employee role here IS that sign-off, done as part of shipping the module. Everything
-- under hr.* is HR's own from here on; no further core review needed to add more later.
--
-- Deliberately NOT creating permission_groups/role_permission_groups rows here — bundling
-- these into groups and deciding which roles get them is config for /admin/permission-groups
-- and /admin/roles, not a migration (06-hr-module-design.md §4).
-- ===========================================================================

insert into permissions (key, module, description) values
  ('module:hr', 'hr', 'Open the HR module (submit tickets, use anonymous feedback)'),
  ('hr.manage_tickets', 'hr', 'View all tickets, assign, reply, change status'),
  ('hr.manage_anonymous_feedback', 'hr', 'Read/reply to anonymous conversations for your assigned department(s)'),
  ('hr.manage_categories', 'hr', 'Create/edit ticket categories and category-to-assignee mapping')
on conflict (key) do nothing;
