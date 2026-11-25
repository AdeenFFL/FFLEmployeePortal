import {
  BellIcon,
  KeyIcon,
  LaptopIcon,
  ShoppingBagIcon,
  TicketIcon,
  UsersIcon,
} from "@/components/icons";

// What a notification is about: its category, icon and colour. Shared by the top-bar bell
// (components/notification-bell.tsx) and the Notifications page, so both always agree. Worked out
// from the event name (it.notify calls across the IT migrations) and which record it points at.
export type NotificationCategory = "ticket" | "people" | "procurement" | "asset" | "account" | "other";

export type NotificationKind = {
  key: NotificationCategory;
  label: string;
  icon: typeof BellIcon;
  chip: string;
};

export const NOTIFICATION_KINDS: Record<NotificationCategory, NotificationKind> = {
  ticket: { key: "ticket", label: "Tickets", icon: TicketIcon, chip: "bg-blue-100 text-blue-700" },
  people: { key: "people", label: "On/offboarding", icon: UsersIcon, chip: "bg-emerald-100 text-emerald-700" },
  procurement: { key: "procurement", label: "Procurement", icon: ShoppingBagIcon, chip: "bg-amber-100 text-amber-700" },
  asset: { key: "asset", label: "Assets", icon: LaptopIcon, chip: "bg-violet-100 text-violet-700" },
  account: { key: "account", label: "Your access", icon: KeyIcon, chip: "bg-rose-100 text-rose-700" },
  other: { key: "other", label: "Other", icon: BellIcon, chip: "bg-slate-100 text-slate-600" },
};

export const NOTIFICATION_CATEGORY_ORDER: NotificationCategory[] = [
  "ticket",
  "people",
  "procurement",
  "asset",
  "account",
  "other",
];

type Classifiable = {
  event: string;
  ticket_id: string | null;
  request_id: string | null;
  demand_id: string | null;
  invoice_id: string | null;
};

export function notificationCategory(n: Classifiable): NotificationCategory {
  const e = n.event;
  if (e.startsWith("asset_")) return "asset";
  if (e === "role_changed" || e === "access_changed") return "account";
  if (n.demand_id || n.invoice_id || /demand|invoice|payment|procure/.test(e)) return "procurement";
  if (n.ticket_id || e.startsWith("ticket_")) return "ticket";
  if (n.request_id || /lifecycle|onboarding|offboarding|task_|clearance/.test(e)) return "people";
  return "other";
}

export function notificationKind(n: Classifiable): NotificationKind {
  return NOTIFICATION_KINDS[notificationCategory(n)];
}
