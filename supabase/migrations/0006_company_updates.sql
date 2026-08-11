-- Employee Portal — Company Updates module: announcements + polls.
-- Purely additive: no changes to any table, policy, or function from 0001-0005.

-- ---------------------------------------------------------------------------
-- is_hr_or_admin: same shape as is_admin (0002), just widened to HR + Admin. Reused by every
-- write policy below and by the compose Server Actions' requireHrOrAdmin() re-check.
-- ---------------------------------------------------------------------------

create function is_hr_or_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from profiles p
    join roles r on r.id = p.role_id
    where p.id = uid
      and r.name in ('HR', 'Admin')
      and p.status = 'Active'
  );
$$;

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_pinned boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger announcements_set_updated_at
  before update on announcements
  for each row execute function set_updated_at();

alter table announcements enable row level security;

create policy "announcements select all" on announcements
  for select to authenticated using (true);

create policy "announcements write by hr or admin" on announcements
  for all to authenticated
  using (is_hr_or_admin(auth.uid()))
  with check (is_hr_or_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- polls + poll_options
-- ---------------------------------------------------------------------------

create table polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger polls_set_updated_at
  before update on polls
  for each row execute function set_updated_at();

alter table polls enable row level security;

create policy "polls select all" on polls
  for select to authenticated using (true);

create policy "polls write by hr or admin" on polls
  for all to authenticated
  using (is_hr_or_admin(auth.uid()))
  with check (is_hr_or_admin(auth.uid()));

create table poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  sort_order int not null default 0
);

alter table poll_options enable row level security;

create policy "poll_options select all" on poll_options
  for select to authenticated using (true);

-- Options are fixed at poll creation — no update/delete policy; removed only via cascading
-- poll delete (which itself is gated by "polls write by hr or admin" above).
create policy "poll_options insert by hr or admin" on poll_options
  for insert to authenticated with check (is_hr_or_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- poll_votes. No insert/update policy at all — every write goes through cast_poll_vote() below
-- (security definer, bypasses RLS internally). Select is deliberately narrow (own vote, or
-- hr_or_admin) so aggregate tallies must go through poll_results() rather than a client-side
-- select-all, which would otherwise leak who-voted-for-what to any employee.
-- ---------------------------------------------------------------------------

create table poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  voted_at timestamptz not null default now(),
  unique (poll_id, voter_id)
);

alter table poll_votes enable row level security;

create policy "poll_votes select own or hr_or_admin" on poll_votes
  for select to authenticated
  using (voter_id = auth.uid() or is_hr_or_admin(auth.uid()));

create function cast_poll_vote(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from polls where id = p_poll_id and status = 'Open') then
    raise exception 'This poll is closed.';
  end if;

  if not exists (select 1 from poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'Invalid option for this poll.';
  end if;

  insert into poll_votes (poll_id, option_id, voter_id)
  values (p_poll_id, p_option_id, auth.uid())
  on conflict (poll_id, voter_id)
  do update set option_id = excluded.option_id, voted_at = now();
end;
$$;

revoke all on function cast_poll_vote(uuid, uuid) from public;
grant execute on function cast_poll_vote(uuid, uuid) to authenticated;

create function poll_results(p_poll_id uuid)
returns table (option_id uuid, vote_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select option_id, count(*) as vote_count
  from poll_votes
  where poll_id = p_poll_id
  group by option_id;
$$;

revoke all on function poll_results(uuid) from public;
grant execute on function poll_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Route permission — granted to all four roles (no r.name filter), same pattern as 0003's
-- /profile grant: this page is a base employee item, not role-restricted.
-- ---------------------------------------------------------------------------

insert into permissions (key, module, description) values
  ('route:/company-updates', 'company-updates', 'Access the Company Updates feed');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where p.key = 'route:/company-updates';
