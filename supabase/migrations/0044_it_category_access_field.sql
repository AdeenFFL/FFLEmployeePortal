-- Employee Portal — IT module: lets a category opt in to showing the "Access required" field
-- on the Raise IT Ticket form, instead of that field always being shown regardless of what the
-- ticket is actually about. Same pattern as handled_at (0037_it_site_routing.sql) — a per-category
-- boolean, toggleable from /it/settings/tickets, not hardcoded by category name in the frontend.

begin;

alter table it.ticket_categories
  add column needs_access_field boolean not null default false;

update it.ticket_categories
set needs_access_field = true
where name = 'Access Management'
   or parent_id = (select id from it.ticket_categories where name = 'Access Management' and parent_id is null);

commit;
