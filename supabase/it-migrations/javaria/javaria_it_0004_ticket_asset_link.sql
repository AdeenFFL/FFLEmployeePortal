-- Author:      Javaria
-- Branch:      IT/javaria
-- Feature:     Ticket ↔ asset link (08-it-service-management-plan.md §2 contract
--              "tickets.linked_asset_id → it.assets"; asset-gap review 2026-10-14, gap #1)
-- Depends on:  javaria_it_0001_tickets.sql (tickets.linked_asset_id, plain uuid until now);
--              talha_it_0003_assets.sql / 0028_it_assets.sql (it.assets)
-- Applied to live DB: NO
--
-- Gap #1 from the asset review: a ticket stores a device id, but nothing checked the device
-- exists, so a ticket could point at a non-existent or deleted asset and skew reports such as
-- "which laptop model fails most". This adds the foreign key the plan deferred until Talha's
-- it.assets existed, refuses links to soft-deleted assets, and gives the ticket screens a safe
-- way to search and display assets.
--
-- Why helpers instead of reading it.assets directly: it.assets is readable only with
-- it.assets.read (0028). The requester and many IT staff don't hold that, but should still see
-- "Device: AST-000123 · HP ProBook 450" on a ticket that's about that device.

-- ---------------------------------------------------------------------------
-- 1. Foreign key. Clear any value that doesn't match a real asset first, so the constraint
--    can be added on the live table (the column was free uuid until now; no ticket UI ever
--    set it, so this is expected to touch zero rows).
-- ---------------------------------------------------------------------------

update it.tickets t
   set linked_asset_id = null
 where linked_asset_id is not null
   and not exists (select 1 from it.assets a where a.id = t.linked_asset_id);

-- RESTRICT, not SET NULL: assets are only ever soft-deleted (0028), so a hard delete of an asset
-- that tickets refer to is a mistake that should fail loudly, not silently erase ticket history.
alter table it.tickets
  add constraint tickets_linked_asset_id_fkey
  foreign key (linked_asset_id) references it.assets(id) on delete restrict;

-- (tickets_linked_asset_idx already exists from javaria_it_0001.)

-- ---------------------------------------------------------------------------
-- 2. No new links to soft-deleted assets. Existing links survive a later soft delete — the
--    ticket's history is still true — they just can't be created or re-pointed to one.
--    Security definer: the caller may not be able to read it.assets under RLS.
-- ---------------------------------------------------------------------------

create function it.check_ticket_asset_link()
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

create trigger trg_check_ticket_asset_link
  before insert or update of linked_asset_id on it.tickets
  for each row execute function it.check_ticket_asset_link();

-- ---------------------------------------------------------------------------
-- 3. Asset search for IT staff working tickets (triage / workspace device picker).
-- ---------------------------------------------------------------------------

create function it.search_assets_for_ticket(p_search text)
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
-- 4. Device label for display: tag, name, serial. Security definer bypasses RLS, so who may
--    see a label is spelled out explicitly: IT ticket / asset viewers see any; everyone else
--    only assets linked to a ticket they raised, were raised for, or are assigned.
-- ---------------------------------------------------------------------------

create function it.ticket_asset_labels(p_asset_ids uuid[])
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
