import type {
  ItContactMethod,
  ItTicket,
  ItTicketPriority,
  ItTicketStatus,
  ItTicketTaskStatus,
} from "@/types/database";

// Shared by server and client components in app/(protected)/it/ — keep this file free of
// server-only imports.

export const TICKET_STATUSES: ItTicketStatus[] = [
  "Open",
  "Assigned",
  "In Progress",
  "On Hold",
  "Resolved",
  "Closed",
];

// Statuses a team member can move a ticket to by hand. Resolved needs the resolve form
// (resolution notes) and Closed needs it.tickets.close, so both have their own actions.
export const WORKING_STATUSES: ItTicketStatus[] = ["Assigned", "In Progress", "On Hold"];

export const TICKET_PRIORITIES: ItTicketPriority[] = ["Critical", "High", "Medium", "Low"];

export const CONTACT_METHODS: ItContactMethod[] = ["Portal", "Email", "Phone", "Teams"];

export const TASK_STATUSES: ItTicketTaskStatus[] = [
  "Pending",
  "In Progress",
  "Completed",
  "Cancelled",
];

type Tone = "positive" | "neutral" | "warning" | "negative" | "info";

export const STATUS_TONE: Record<ItTicketStatus, Tone> = {
  Open: "info",
  Assigned: "info",
  "In Progress": "warning",
  "On Hold": "neutral",
  Resolved: "positive",
  Closed: "neutral",
};

export const PRIORITY_TONE: Record<ItTicketPriority, Tone> = {
  Critical: "negative",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

export const TASK_STATUS_TONE: Record<ItTicketTaskStatus, Tone> = {
  Pending: "neutral",
  "In Progress": "warning",
  Completed: "positive",
  Cancelled: "neutral",
};

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // matches the storage bucket's limit
// All files together must fit in one Server Action request (next.config.ts bodySizeLimit).
export const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;

// How a ticket stands against its resolution SLA (BRD §5.3.8 / §5.3.10). "Due soon" is the
// last 20% of the window, so IT sees it before it breaches.
export type SlaState = "met" | "breached" | "overdue" | "due_soon" | "on_track" | "none";

export function slaState(
  ticket: Pick<ItTicket, "created_at" | "resolution_due_at" | "resolved_at" | "status">,
  now: Date = new Date(),
): SlaState {
  if (!ticket.resolution_due_at) return "none";
  const due = new Date(ticket.resolution_due_at).getTime();

  if (ticket.resolved_at && (ticket.status === "Resolved" || ticket.status === "Closed")) {
    return new Date(ticket.resolved_at).getTime() <= due ? "met" : "breached";
  }
  if (now.getTime() > due) return "overdue";

  const created = new Date(ticket.created_at).getTime();
  const remaining = due - now.getTime();
  return remaining <= (due - created) * 0.2 ? "due_soon" : "on_track";
}

export const SLA_LABEL: Record<SlaState, { label: string; tone: Tone }> = {
  met: { label: "SLA met", tone: "positive" },
  breached: { label: "SLA breached", tone: "negative" },
  overdue: { label: "Overdue", tone: "negative" },
  due_soon: { label: "Due soon", tone: "warning" },
  on_track: { label: "On track", tone: "neutral" },
  none: { label: "No SLA", tone: "neutral" },
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
