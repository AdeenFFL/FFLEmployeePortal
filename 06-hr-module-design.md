# HR Module (M1) — Design Document

Written against the Module Onboarding SOP (`01-platform-design-and-sop.md` §11). This is the
first module built on top of the base skeleton, and the first to actually get its own Postgres
schema (`hr`) rather than the flat `public` schema the base ended up using — see `context.md`
§4's 2026-09-22 entry for why.

**Scope of this pass — the two features named in `context.md` §2, nothing else:**
1. Anonymous feedback chat with an HRBP, reachable outside login.
2. Non-anonymous feedback/requests (tickets), inside login, assigned by category.

`internal-jobs`, `policy-library`, `quarter-quest`, `hr-contact-directory` (already sitting
unwired in `app/(protected)/hr/`) are explicitly **out of scope** here — separate future
features, not part of M1's two stated pieces. Leave them alone.

---

## 1. Decisions this doc is written against (don't re-litigate without reason)

- **Anonymity model: fully anonymous, no recovery, ever** (decided 2026-09-22). No identity is
  stored for the submitter side of the anonymous chat — not `person_id`, not IP, not a
  fingerprint, nothing. The only continuity mechanism is an unguessable conversation token
  (the row's own UUID) that the submitter's browser holds onto to check for replies. This is a
  real, accepted tradeoff: there is no recourse if the channel is abused, and no way to loop a
  submitter back in if a reported situation needs a name attached. If that tradeoff needs
  revisiting later, it's a policy conversation, not a migration.
- **Schema: `hr.*`, a real Postgres schema** (decided 2026-09-22) — not `hr_`-prefixed tables in
  `public`. `create schema hr;` is step 2 of this module's onboarding.
- Department routing for the anonymous chat is **self-selected by the submitter at chat start**
  (a dropdown), not looked up — there's no account to look anything up from.

---

## 2. Module registration

| Field | Value |
|---|---|
| Module code | `hr` |
| Schema | `hr` |
| Coarse access permission | `module:hr` |
| Owning team | HR (you, for this pass) |
| Status | `planned` → `active` once shipped |

`module:hr` should be granted broadly — to the base "Employee" role, not just HR staff.
Submitting a ticket and using the anonymous chat are things every employee needs, same as M2's
"two broad user classes" pattern (general employees vs. specialist staff) will be. The
fine-grained `hr.manage_*` codes below are what actually gate the HR-staff side.

---

## 3. Schema

```sql
create schema hr;
```

### 3.1 Anonymous feedback chat

```sql
-- The conversation's own id IS the access token — unguessable (gen_random_uuid()), given to
-- the submitter once, held in their browser (localStorage), never logged anywhere else.
-- Deliberately no person_id, no ip/user-agent column, no created_by. That's the whole point.
create table hr.anonymous_conversations (
  id uuid primary key default gen_random_uuid(),
  department_org_unit_id uuid not null references public.org_units(id),
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hr.anonymous_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references hr.anonymous_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('submitter', 'hr')),
  -- Populated only when sender_type = 'hr'; the trigger below enforces this both ways, so an
  -- HR reply can never accidentally be misfiled as anonymous and a submitter message can never
  -- carry an identity.
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

-- Which HRBP(s) cover which department — module-specific scoping, deliberately not reusing
-- user_roles.site_id/company_id (those are generic identity-layer scoping; this is HR's own
-- business rule about who reads what, and belongs in HR's schema).
create table hr.hrbp_departments (
  person_id uuid not null references public.persons(id) on delete cascade,
  department_org_unit_id uuid not null references public.org_units(id) on delete cascade,
  primary key (person_id, department_org_unit_id)
);
```

**RLS — the module-specific auth exception the SOP allows for (§11 step 6, "a public-facing
external form"):** the submitter side is never queried directly by an `anon`-role Supabase
client. RLS on `hr.anonymous_conversations`/`hr.anonymous_messages` stays deny-by-default for
both `anon` and `authenticated` except the explicit HR-staff policy below. All anonymous
submit/read-reply traffic goes through Server Actions using the service-role client (same
pattern already used by `app/auth/callback/route.ts` and password-account creation) — the
*application code*, not RLS, is what enforces "you may only read/write the conversation whose
token you supply." This is a deliberate choice: it keeps the security model in one place
(reviewable application code) instead of a permissive `using (true)` RLS policy that would let
any anonymous client query the table directly.

```sql
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

-- HR replies go through a security-definer function (mirrors current_person_id()'s shape),
-- not a raw insert policy — keeps "must be scoped to your own department" enforced in one
-- place rather than duplicated between RLS and every call site.
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

create policy "hrbp_departments hr read own, admin manage" on hr.hrbp_departments
  for select to authenticated using (
    person_id = current_person_id() or has_permission('hr.manage_anonymous_feedback')
  );
```

### 3.2 Tickets (non-anonymous feedback/requests)

```sql
create table hr.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  -- Denormalized from persons at creation time, per Section 7's "site/company scoping column
  -- on every transactional table" convention — makes reporting/filtering by site cheap without
  -- a join back through persons on every query.
  company_id uuid references public.companies(id),
  site_id uuid references public.org_units(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.persons(id),
  updated_by uuid references public.persons(id)
);

create table hr.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references hr.tickets(id) on delete cascade,
  sender_person_id uuid not null references public.persons(id),
  body text not null,
  created_at timestamptz not null default now()
);
```

**RLS:**

```sql
alter table hr.ticket_categories enable row level security;
alter table hr.ticket_category_assignees enable row level security;
alter table hr.tickets enable row level security;
alter table hr.ticket_messages enable row level security;

create policy "ticket_categories readable by authenticated" on hr.ticket_categories
  for select to authenticated using (true);

create policy "ticket_categories write by hr admin" on hr.ticket_categories
  for all to authenticated
  using (has_permission('hr.manage_tickets')) with check (has_permission('hr.manage_tickets'));

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
```

---

## 4. Permission codes

Registered per §11 step 4 — `module:hr` needs core-team (you) sign-off since it gates the route
boundary; everything under `hr.*` is HR's own to create/change via `/admin/permission-groups`.

| Key | Module | Grants |
|---|---|---|
| `module:hr` | `hr` | Can open `app/(protected)/hr/**` at all. Grant to base Employee role. |
| `hr.manage_tickets` | `hr` | View all tickets, assign, reply, change status. |
| `hr.manage_anonymous_feedback` | `hr` | Read/reply to anonymous conversations for your assigned department(s) (`hr.hrbp_departments`). |
| `hr.manage_categories` | `hr` | Create/edit ticket categories and category→assignee mapping. |

Bundle these into permission groups (e.g. "HR Ticket Handling", "HRBP") via `/admin/permission-groups` once the schema exists — that's config, not a migration.

---

## 5. Integration events (§10)

**None emitted or consumed for this pass.** The natural future hook is IT's offboarding event
(auto-close a departed employee's open tickets) once M2 exists and the HR/IT system-of-record
question (`context.md` §6) is resolved — don't build a consumer for an event that doesn't exist
yet.

---

## 6. Folder plan

```
app/feedback/                          ← PUBLIC route, outside the (protected) group entirely.
  page.tsx                             Anonymous chat UI: department dropdown to start, or a
                                        token (from localStorage / pasted back in) to resume.
  actions.ts                           startAnonymousConversation(), sendAnonymousMessage() —
                                        service-role client, per §3.1's RLS note above.

app/(protected)/hr/
  dashboard/                           HR-staff landing: open ticket queue + anonymous
                                        conversation queue for your department(s). (Currently a
                                        stub — this is what makes it real.)
  tickets/
    page.tsx                           Employee-facing: submit a ticket, see your own history.
    actions.ts                         createTicket(), replyToTicket()
    [id]/page.tsx                      Single ticket thread (submitter or assigned HR view).
  feedback/
    page.tsx                           HR-staff: ticket queue (filter by category/status).
    anonymous/page.tsx                 HR-staff: anonymous conversation queue, reply UI.
  admin/categories/                    HR-staff: manage hr.ticket_categories + assignees
                                        (gated by hr.manage_categories).
```

`proxy.ts`'s `PUBLIC_PATHS` needs `/feedback` added — same treatment as `/login`,
`/forgot-password`.

---

## 7. What's explicitly deferred

- `internal-jobs` / `policy-library` / `quarter-quest` / `hr-contact-directory` — not part of
  this pass (§ scope note at top).
- IT-offboarding → auto-close-tickets integration event (§5).
- Notifying a submitter their anonymous conversation got a reply — no email/push channel exists
  for someone with no identity on file; they have to come back and check with their token. A
  "bookmark this page" reminder in the UI is the only mitigation available under the "no
  recovery ever" model.
