import { COMPANY_EMAIL_DOMAIN } from "@/lib/constants";
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

// Semi-automated email provisioning (IT module revision, part 2): the portal can't create a
// real mailbox itself (the Graph app registration only has Mail.Send, not account/license
// management), so it proposes a username/address from the employee's name and IT confirms it
// while actually creating the mailbox in Microsoft 365, then marks the task complete.
export function suggestEmailAccount(employeeName: string) {
  const parts = employeeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const username = parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "";
  return {
    username,
    email_address: username ? `${username}@${COMPANY_EMAIL_DOMAIN}` : "",
  };
}

// Human-readable label per task type, for the task-type owners settings screen
// (/it/settings/onboarding-owners) — matches the task_name wording the seeding trigger uses.
export const TASK_TYPE_LABELS: Record<ItChecklistTaskType, string> = {
  role_assignment: "Portal Role Assignment",
  email_account: "Email Account Creation",
  license_assignment: "Software License Assignment",
  access_provisioning: "User Access Provisioning",
  software_installation: "Software Installation & Device Configuration",
  asset_allocation: "Asset Allocation & Assignment Form",
  asset_handover: "Asset Handover Confirmation",
  portal_account: "Employee Portal Account Creation",
  email_backup_closure: "Email Backup & Account Closure",
  access_revocation: "User Access Revocation",
  hardware_recovery: "Laptop & Hardware Recovery",
  asset_return: "Asset Return Form",
  license_deactivation: "Software License Deactivation",
  other: "Other",
};

export const TASK_DETAIL_FIELDS: Record<ItChecklistTaskType, DetailField[]> = {
  // No free-text fields — the role picker is a real dropdown in its own dedicated form
  // (assignRoleForOnboardingTask), not a generic detail field.
  role_assignment: [],
  email_account: [
    { key: "email_address", label: "Company email address", placeholder: `name@${COMPANY_EMAIL_DOMAIN}` },
    { key: "username", label: "Username" },
  ],
  license_assignment: [
    {
      key: "license_sku",
      label: "License / SKU assigned",
      placeholder: "Microsoft 365 E3, Adobe Reader DC, …",
      multiline: true,
    },
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
  // No manual fields — completion is driven by the real acknowledgment data on the linked
  // asset_assignments row (it.acknowledge_assignment, "My Assets"), not typed-in details. See
  // app/(protected)/it/onboarding/actions.ts's completeHandoverTask.
  asset_handover: [],
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
