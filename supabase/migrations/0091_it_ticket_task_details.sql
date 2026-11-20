-- Unified Ticket/Task Tracker, Phase 2 (snuggly-swinging-newt.md): structured per-task response
-- fields on ticket tasks, mirroring checklist_items.details (0027_it_onboarding_offboarding.sql)
-- but additive only -- task_kind is nullable and every existing/new free-text task keeps working
-- exactly as before. it.ticket_tasks.task_type stays a free-text task title (e.g. "Replace
-- keyboard"); task_kind is a separate, optional, fixed-vocabulary field that only drives extra
-- structured fields when a task is specifically about one of the kinds below.

begin;

alter table it.ticket_tasks
  add column task_kind text check (task_kind in ('device_check')),
  add column details jsonb not null default '{}'::jsonb;

comment on column it.ticket_tasks.task_kind is
  'Optional, fixed vocabulary (see lib/it/ticket-tasks.ts). Null = plain free-text task, same as before this column existed.';
comment on column it.ticket_tasks.details is
  'Structured response fields for task_kind (e.g. device_check: asset_tag, serial_number, condition). Empty object for a plain task.';

commit;
