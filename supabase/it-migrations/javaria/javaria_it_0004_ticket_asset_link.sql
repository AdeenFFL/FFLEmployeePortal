-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Ticket ↔ asset link (08-it-service-management-plan.md §2 contract
--              "tickets.linked_asset_id → it.assets"; asset-gap review 2026-10-14, gap #1)
-- Depends on:  javaria_it_0001_tickets.sql (tickets.linked_asset_id);
--              talha_it_0003_assets.sql / 0028_it_assets.sql (it.assets);
--              Talha's Phase 3 migration, which owns the FK tickets_linked_asset_id_fkey
--              (07-it-inventory-plan.md: "tickets.linked_asset_id FK moves into the Phase 3
--              migration") — already live on 2026-10-14
-- Applied to live DB: NO
--
-- Gap #1 from the asset review: a ticket stores a device id, but nothing checked the device
-- exists, so a ticket could point at a non-existent or deleted asset and skew reports such as
-- "which laptop model fails most".
--
-- The foreign key itself is NOT in this file. Talha took it into his Phase 3 migration and it
-- was already on the live DB when this file was first run (error 42710, constraint already
-- exists). This file adds what the FK alone doesn't cover: refusing links to soft-deleted
-- assets, and a safe way for ticket screens to search and display assets.
--
-- Why helpers instead of reading it.assets directly: it.assets is readable only with
-- it.assets.read (0028). The requester and many IT staff don't hold that, but should still see
-- "Device: AST-000123 · HP ProBook 450" on a ticket that's about that device.
--
-- Safe to re-run: create or replace / drop trigger if exists throughout.

-- ---------------------------------------------------------------------------
-- 1. No new links to soft-deleted assets. Existing links survive a later soft delete — the
--    ticket's history is still true — they just can't be created or re-pointed to one.
--    Security definer: the caller may not be able to read it.assets under RLS.
-- ---------------------------------------------------------------------------

create or replace function it.check_ticket_asset_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.linked_asset_id is not null
     and (tg_op = 'INSERT' or new.linked_asset_id is distinct from old.linked_asset_id)
     and not exists (
       select 1 from it.assets where id = new.linked_asset_id and deleted_at is null
     ) then
    raise exception 'That asset does not exist or has been deleted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_ticket_asset_link on it.tickets;
create trigger trg_check_ticket_asset_link
  before insert or update of linked_asset_id on it.tickets
  for each row execute function it.check_ticket_asset_link();

-- ---------------------------------------------------------------------------
-- 2. Asset search for IT staff working tickets (triage / workspace device picker).
-- ---------------------------------------------------------------------------

create or replace function it.search_assets_for_ticket(p_search text)
returns table (
  asset_id uuid,
  asset_tag text,
  asset_name text,
  serial_number text,
  status text,
  site_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.asset_tag, a.asset_name, a.serial_number, a.status, a.site_id
  from it.assets a
  where a.deleted_at is null
    and (has_permission('it.tickets.update')
         or has_permission('it.tickets.assign')
         or has_permission('it.assets.read'))
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

-- ---------------------------------------------------------------------------
-- 3. Device label for display: tag, name, serial. Security definer bypasses RLS, so who may
--    see a label is spelled out explicitly: IT ticket / asset viewers see any; everyone else
--    only assets linked to a ticket they raised, were raised for, or are assigned.
-- ---------------------------------------------------------------------------

create or replace function it.ticket_asset_labels(p_asset_ids uuid[])
returns table (asset_id uuid, asset_tag text, asset_name text, serial_number text)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.asset_tag, a.asset_name, a.serial_number
  from it.assets a
  where a.id = any (p_asset_ids)
    and (
      has_permission('it.tickets.read')
      or has_permission('it.assets.read')
      or exists (
        select 1 from it.tickets t
        where t.linked_asset_id = a.id
          and (t.requester_person_id = current_person_id()
               or t.requested_for_person_id = current_person_id()
               or t.assigned_to_person_id = current_person_id())
      )
    );
$$;

revoke all on function it.check_ticket_asset_link() from public;
revoke all on function it.search_assets_for_ticket(text) from public;
revoke all on function it.ticket_asset_labels(uuid[]) from public;
grant execute on function it.search_assets_for_ticket(text) to authenticated;
grant execute on function it.ticket_asset_labels(uuid[]) to authenticated;
