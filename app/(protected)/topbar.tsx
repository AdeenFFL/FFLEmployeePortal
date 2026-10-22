import { HelpCircleIcon } from "@/components/icons";
import { NotificationBell } from "@/components/notification-bell";
import { SUPPORT_EMAIL } from "@/lib/constants";
import type { RecentNotification } from "./notification-actions";

export function TopBar({
  displayName,
  unreadCount = 0,
  notifications = [],
}: {
  displayName: string;
  unreadCount?: number;
  notifications?: RecentNotification[];
}) {
  const initials =
    displayName
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="flex items-center justify-end gap-4 px-8 py-4">
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        aria-label="Help"
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <HelpCircleIcon className="h-5 w-5" />
      </a>
      {/* Inbox lives in the IT module for now (it.notifications) — the only module with one. */}
      <NotificationBell initialUnreadCount={unreadCount} initialNotifications={notifications} />
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700"
        title={displayName}
      >
        {initials}
      </div>
    </div>
  );
}
