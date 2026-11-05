-- Employee Portal — core: collapses proxy.ts's remaining 3 sequential round trips (account +
-- status lookup, role-assignment check, permission check) into one. Timing on the live dev
-- server showed the previous route_permission_allowed() merge (0045) wasn't enough — the
-- dominant cost is network round-trip latency to Supabase itself, not any one query's
-- complexity, so the fix is fewer round trips, not faster ones. Supersedes and replaces
-- route_permission_allowed() (0045) as proxy.ts's only per-request RPC besides the unavoidable
-- session-refresh call.
--
-- `from (select 1) as one left join user_accounts ...` guarantees exactly one output row even
-- when the caller has no user_accounts row yet (the "just came back from OAuth, account not
-- provisioned yet" edge case proxy.ts already special-cases) — every column comes back null
-- instead of the query returning zero rows, so proxy.ts doesn't need separate empty-vs-error
-- handling.

begin;

drop function if exists route_permission_allowed(text);

create or replace function resolve_proxy_access(p_permission_key text default null)
returns table (
  person_id uuid,
  is_active boolean,
  has_role boolean,
  permission_ok boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ua.person_id,
    (ua.id is null) or (ua.status = 'Active' and p.status = 'Active') as is_active,
    exists (select 1 from user_roles ur where ur.person_id = ua.person_id) as has_role,
    (
      p_permission_key is null
      or not exists (select 1 from permissions perm where perm.key = p_permission_key)
      or exists (
        select 1
        from user_roles ur2
        join role_permissions rp on rp.role_id = ur2.role_id
        join permissions perm2 on perm2.id = rp.permission_id
        where ur2.person_id = ua.person_id and perm2.key = p_permission_key
      )
    ) as permission_ok
  from (select 1) as one
  left join user_accounts ua on ua.auth_user_id = auth.uid()
  left join persons p on p.id = ua.person_id;
$$;

revoke all on function resolve_proxy_access(text) from public;
grant execute on function resolve_proxy_access(text) to authenticated;

commit;
