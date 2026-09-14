-- Employee Portal — Base-skeleton strip.
--
-- Decision: the portal is being reset to a minimal base skeleton (Users & Role Creation, Sites
-- configuration, Dashboard, Access to modules) with everything else configured bottom-up as
-- each module (HR, IT Service Management, Mess+FPS, HSE) gets designed and built with its own
-- schema. See context.md for the decision record and the app-code changes that accompany this
-- migration (routes/components for these features were removed in the same change).
--
-- Removed entirely: educational_documents, dependents, insurance_policies (profile sub-features
-- not part of the 4-module roadmap), announcements/polls (company-updates feature).
--
-- NOT dropped, on purpose:
--   - is_admin() / is_hr_or_admin() — core RBAC helpers, not specific to what's being removed
--     here. Every future module reuses this exact shape (see 04-claude-code-refactor-
--     instructions.md Section 1, "Do not touch").
--   - The `employee-documents` storage bucket and its 3 policies (0003) — generic
--     {auth.uid()}/<anything> path scoping, not tied to education/dependents specifically. Left
--     in place for whichever module needs per-user document upload next.

drop table if exists poll_votes;
drop table if exists poll_options;
drop table if exists polls;
drop table if exists announcements;
drop table if exists insurance_policies;
drop table if exists dependents;
drop table if exists educational_documents;

drop function if exists cast_poll_vote(uuid, uuid);
drop function if exists poll_results(uuid);

-- Orphaned route permissions for the removed pages. role_permissions rows referencing these
-- cascade automatically (role_permissions.permission_id references permissions(id) on delete
-- cascade, per 0001).
delete from permissions where key in ('route:/company-updates', 'route:/profile/insurance');
