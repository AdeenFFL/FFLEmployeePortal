-- Employee Portal — IT module: let onboarding's "Asset Allocation" checklist task search real,
-- unassigned assets (IT module revision, Phase 3). Previously this task only recorded a
-- free-text asset_tag note and never touched it.assign_asset()/it.asset_assignments — this
-- lets the IT Executive actually hand over a real asset from the register while working the
-- onboarding checklist. Gated the same as it.assign_asset() itself (it.assets.assign), since
-- that's the RPC this search feeds into — no point searching more broadly than the action that
-- follows can authorize.

begin;

create or replace function it.search_unassigned_assets(p_search text)
returns table (
  asset_id uuid,
  asset_tag text,
  asset_name text,
  serial_number text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.asset_tag, a.asset_name, a.serial_number
  from it.assets a
  where a.deleted_at is null
    and a.status = 'Unassigned'
    and has_permission('it.assets.assign')
    and coalesce(trim(p_search), '') <> ''
    and (
      a.asset_tag ilike '%' || trim(p_search) || '%'
      or a.serial_number ilike '%' || trim(p_search) || '%'
      or a.asset_name ilike '%' || trim(p_search) || '%'
      or a.model_number ilike '%' || trim(p_search) || '%'
    )
  order by a.asset_tag
  limit 25;
$$;

revoke all on function it.search_unassigned_assets(text) from public;
grant execute on function it.search_unassigned_assets(text) to authenticated;

commit;
