import type {
  ItChecklistStatus,
  ItChecklistTaskType,
  ItLifecycleKind,
  ItLifecycleStatus,
} from "@/types/database";

// Shared by server and client components in app/(protected)/it/onboarding — keep this file free
// of server-only imports. Mirrors javaria_it_0002_onboarding_offboarding.sql.

type Tone = "positive" | "neutral" | "warning" | "negative" | "info";

export const LIFECYCLE_KINDS: ItLifecycleKind[] = ["Onboarding", "Offboarding", "Replacement"];

export const LIFECYCLE_STATUSES: ItLifecycleStatus[] = [
  "Open",
  "Under Review",
  "In Progress",
  "Awaiting Confirmation",
  "Pending Final Review",
  "Completed",
  "Closed",
  "Cancelled",
];

export const FINISHED_STATUSES: ItLifecycleStatus[] = ["Completed", "Closed", "Cancelled"];

export const LIFECYCLE_STATUS_TONE: Record<ItLifecycleStatus, Tone> = {
  Open: "info",
  "Under Review": "info",
  "In Progress": "warning",
  "Awaiting Confirmation": "warning",
  "Pending Final Review": "warning",
  Completed: "positive",
  Closed: "neutral",
  Cancelled: "neutral",
};

export const KIND_TONE: Record<ItLifecycleKind, Tone> = {
  Onboarding: "positive",
  Offboarding: "negative",
  Replacement: "info",
};

export const CHECKLIST_STATUSES: ItChecklistStatus[] = [
  "Pending",
  "In Progress",
  "Completed",
  "Not Applicable",
];

export const CHECKLIST_STATUS_TONE: Record<ItChecklistStatus, Tone> = {
  Pending: "neutral",
  "In Progress": "warning",
  Completed: "positive",
  "Not Applicable": "neutral",
};

// What each task records when it's worked (stored in checklist_items.details). Field keys match
// the comment on it.checklist_items in the migration. Passwords are never collected.
export type DetailField = { key: string; label: string; placeholder?: string; multiline?: boolean };

const ASSET_FIELDS: DetailField[] = [
  { key: "asset_tag", label: "Asset tag", placeholder: "e.g. FFL-LAP-000123" },
  { key: "serial_number", label: "Serial number" },
  { key: "condition", label: "Condition", placeholder: "e.g. Good, minor scratches" },
];

export const TASK_DETAIL_FIELDS: Record<ItChecklistTaskType, DetailField[]> = {
  email_account: [
    { key: "email_address", label: "Company email address", placeholder: "name@faujifoods.com" },
    { key: "username", label: "Username" },
  ],
  access_provisioning: [
    {
      key: "accesses",
      label: "Accesses granted",
      placeholder: "Teams, SharePoint, VPN, ERP, shared folders…",
      multiline: true,
    },
  ],
  software_installation: [
    {
      key: "software",
      label: "Software installed",
      placeholder: "Office, Outlook, Adobe Reader, antivirus, ERP client…",
      multiline: true,
    },
  ],
  asset_allocation: ASSET_FIELDS,
  portal_account: [{ key: "username", label: "Portal username" }],
  email_backup_closure: [
    { key: "backup_date", label: "Mailbox backup date", placeholder: "YYYY-MM-DD" },
    { key: "mailbox_status", label: "Mailbox status", placeholder: "Backed up / Closed" },
  ],
  access_revocation: [
    { key: "accesses", label: "Accesses revoked", multiline: true },
  ],
  hardware_recovery: [
    {
      key: "items",
      label: "Items recovered",
      placeholder: "Laptop, charger, mobile, access card…",
      multiline: true,
    },
  ],
  asset_return: ASSET_FIELDS,
  license_deactivation: [
    { key: "licenses", label: "Licences deactivated", multiline: true },
  ],
  other: [],
};
