-- Employee Portal — IT module: let a ticket requester search their OWN assets when filing a
-- ticket (IT module revision, Phase 2). The existing it.search_assets_for_ticket (staged in
-- supabase/it-migrations/javaria/javaria_it_0004_ticket_asset_link.sql, not yet in the main
-- sequence) is deliberately staff-only (has_permission('it.tickets.update'/'it.tickets.assign'/
-- 'it.assets.read')) and searches the entire asset register — correct for staff triage, wrong
-- for a requester (would let any employee enumerate every company asset). This is a separate,
-- narrower function instead of a widened version of that one.

begin;

-- (tickets.linked_asset_id's FK to it.assets — once a documented placeholder — already exists
-- live as "tickets_linked_asset_id_fkey", added by a prior merge ("Link tickets to assets",
-- asset-gap review #1). Verified before writing this migration; nothing to do here.)

create or replace function it.search_my_assets_for_ticket(p_search text)
returns table (
  asset_id uuid,
  asset_tag text,
  asset_name text,
  serial_number text,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.asset_tag, a.asset_name, a.serial_number, a.status
  from it.assets a
  join it.asset_assignments aa on aa.asset_id = a.id
  where a.deleted_at is null
    and aa.person_id = current_person_id()
    and aa.return_date is null
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

revoke all on function it.search_my_assets_for_ticket(text) from public;
grant execute on function it.search_my_assets_for_ticket(text) to authenticated;

commit;
