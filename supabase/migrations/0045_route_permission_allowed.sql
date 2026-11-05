-- Employee Portal — core: collapses proxy.ts's two sequential round trips (does this permission
-- key even exist? -> is it granted?) into one. Same fail-open behavior as before (an unmapped
-- permission key allows the route through rather than locking everyone out over a config
-- mismatch) — this is a pure round-trip merge, not a behavior change. Runs on every single
-- protected-route navigation, so it's worth a dedicated function.

begin;

create or replace function route_permission_allowed(p_permission_key text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    not exists (select 1 from permissions where key = p_permission_key)
    or has_permission(p_permission_key);
$$;

revoke all on function route_permission_allowed(text) from public;
grant execute on function route_permission_allowed(text) to authenticated;

commit;
