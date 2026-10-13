-- Employee Portal — converts every NO ACTION foreign key referencing persons(id) to ON DELETE
-- CASCADE, so that deleting a person genuinely deletes all of their data in one statement.
-- Deliberate, explicit choice (not the usual "actor reference" pattern): a ticket assigned to a
-- deleted person, an onboarding case they approved, a shared asset type/request type they
-- created — all get deleted too, even where that record is "owned" by someone else. This is a
-- hard-delete feature for Admin → Users; soft-delete (status-based, no data loss) is a separate,
-- deferred feature — see app/(protected)/admin/users/actions.ts's hardDeleteUser().
--
-- NOT touched, deliberately: audit_log.actor_id, role_permissions.granted_by,
-- user_roles.granted_by — already ON DELETE SET NULL. These are provenance stamps on
-- system/audit records, not the deleted person's own data; cascading them would destroy other
-- people's audit trail and role-grant history just because the person who performed/approved an
-- action was later deleted.

alter table hr.anonymous_messages drop constraint anonymous_messages_sender_person_id_fkey;
alter table hr.anonymous_messages add constraint anonymous_messages_sender_person_id_fkey
  foreign key (sender_person_id) references public.persons(id) on delete cascade;

alter table hr.ticket_messages drop constraint ticket_messages_sender_person_id_fkey;
alter table hr.ticket_messages add constraint ticket_messages_sender_person_id_fkey
  foreign key (sender_person_id) references public.persons(id) on delete cascade;

alter table hr.tickets drop constraint tickets_assigned_to_person_id_fkey;
alter table hr.tickets add constraint tickets_assigned_to_person_id_fkey
  foreign key (assigned_to_person_id) references public.persons(id) on delete cascade;
alter table hr.tickets drop constraint tickets_created_by_fkey;
alter table hr.tickets add constraint tickets_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table hr.tickets drop constraint tickets_person_id_fkey;
alter table hr.tickets add constraint tickets_person_id_fkey
  foreign key (person_id) references public.persons(id) on delete cascade;
alter table hr.tickets drop constraint tickets_updated_by_fkey;
alter table hr.tickets add constraint tickets_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.asset_types drop constraint asset_types_created_by_fkey;
alter table it.asset_types add constraint asset_types_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.asset_types drop constraint asset_types_updated_by_fkey;
alter table it.asset_types add constraint asset_types_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.asset_value_types drop constraint asset_value_types_created_by_fkey;
alter table it.asset_value_types add constraint asset_value_types_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.asset_value_types drop constraint asset_value_types_updated_by_fkey;
alter table it.asset_value_types add constraint asset_value_types_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.assets drop constraint assets_created_by_fkey;
alter table it.assets add constraint assets_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.assets drop constraint assets_updated_by_fkey;
alter table it.assets add constraint assets_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.checklist_items drop constraint checklist_items_assigned_to_person_id_fkey;
alter table it.checklist_items add constraint checklist_items_assigned_to_person_id_fkey
  foreign key (assigned_to_person_id) references public.persons(id) on delete cascade;
alter table it.checklist_items drop constraint checklist_items_completed_by_fkey;
alter table it.checklist_items add constraint checklist_items_completed_by_fkey
  foreign key (completed_by) references public.persons(id) on delete cascade;
alter table it.checklist_items drop constraint checklist_items_created_by_fkey;
alter table it.checklist_items add constraint checklist_items_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;

alter table it.onboarding_offboarding drop constraint onboarding_offboarding_created_by_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_executive_signed_by_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_executive_signed_by_fkey
  foreign key (executive_signed_by) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_hod_signed_by_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_hod_signed_by_fkey
  foreign key (hod_signed_by) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_it_executive_person_id_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_it_executive_person_id_fkey
  foreign key (it_executive_person_id) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_person_id_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_person_id_fkey
  foreign key (person_id) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_requested_by_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_requested_by_fkey
  foreign key (requested_by) references public.persons(id) on delete cascade;
alter table it.onboarding_offboarding drop constraint onboarding_offboarding_updated_by_fkey;
alter table it.onboarding_offboarding add constraint onboarding_offboarding_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.onboarding_updates drop constraint onboarding_updates_author_person_id_fkey;
alter table it.onboarding_updates add constraint onboarding_updates_author_person_id_fkey
  foreign key (author_person_id) references public.persons(id) on delete cascade;

alter table it.request_types drop constraint request_types_created_by_fkey;
alter table it.request_types add constraint request_types_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.request_types drop constraint request_types_updated_by_fkey;
alter table it.request_types add constraint request_types_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table it.ticket_attachments drop constraint ticket_attachments_uploaded_by_fkey;
alter table it.ticket_attachments add constraint ticket_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references public.persons(id) on delete cascade;

alter table it.ticket_tasks drop constraint ticket_tasks_assigned_to_person_id_fkey;
alter table it.ticket_tasks add constraint ticket_tasks_assigned_to_person_id_fkey
  foreign key (assigned_to_person_id) references public.persons(id) on delete cascade;
alter table it.ticket_tasks drop constraint ticket_tasks_created_by_fkey;
alter table it.ticket_tasks add constraint ticket_tasks_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;

alter table it.ticket_updates drop constraint ticket_updates_author_person_id_fkey;
alter table it.ticket_updates add constraint ticket_updates_author_person_id_fkey
  foreign key (author_person_id) references public.persons(id) on delete cascade;

alter table it.tickets drop constraint tickets_assigned_to_person_id_fkey;
alter table it.tickets add constraint tickets_assigned_to_person_id_fkey
  foreign key (assigned_to_person_id) references public.persons(id) on delete cascade;
alter table it.tickets drop constraint tickets_created_by_fkey;
alter table it.tickets add constraint tickets_created_by_fkey
  foreign key (created_by) references public.persons(id) on delete cascade;
alter table it.tickets drop constraint tickets_escalated_by_fkey;
alter table it.tickets add constraint tickets_escalated_by_fkey
  foreign key (escalated_by) references public.persons(id) on delete cascade;
alter table it.tickets drop constraint tickets_requested_for_person_id_fkey;
alter table it.tickets add constraint tickets_requested_for_person_id_fkey
  foreign key (requested_for_person_id) references public.persons(id) on delete cascade;
alter table it.tickets drop constraint tickets_requester_person_id_fkey;
alter table it.tickets add constraint tickets_requester_person_id_fkey
  foreign key (requester_person_id) references public.persons(id) on delete cascade;
alter table it.tickets drop constraint tickets_updated_by_fkey;
alter table it.tickets add constraint tickets_updated_by_fkey
  foreign key (updated_by) references public.persons(id) on delete cascade;

alter table public.invited_users drop constraint invited_users_invited_by_fkey;
alter table public.invited_users add constraint invited_users_invited_by_fkey
  foreign key (invited_by) references public.persons(id) on delete cascade;
