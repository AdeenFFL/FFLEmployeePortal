import type { DetailField } from "@/lib/it/onboarding";
import type { ItTicketTaskKind } from "@/types/database";

// Structured response fields for ticket tasks (Unified Ticket/Task Tracker, Phase 2 —
// 0091_it_ticket_task_details.sql). Mirrors lib/it/onboarding.ts's TASK_DETAIL_FIELDS shape —
// reusing its DetailField type rather than redefining it. Most tasks have no task_kind at all
// (plain free-text title + optional description, unchanged); task_kind only applies when a task
// is specifically about one of the kinds below, and only then does the Add/Update task form show
// these extra fields.

export const TASK_KIND_LABELS: Record<ItTicketTaskKind, string> = {
  device_check: "Device check",
};

export const TASK_KIND_DETAIL_FIELDS: Record<ItTicketTaskKind, DetailField[]> = {
  device_check: [
    { key: "asset_tag", label: "Asset tag", placeholder: "e.g. FFL-LAP-000123" },
    { key: "serial_number", label: "Serial number" },
    { key: "condition", label: "Condition", placeholder: "e.g. Good, minor scratches" },
  ],
};
