import Link from "next/link";
import { BellIcon, HelpCircleIcon } from "@/components/icons";
import { SUPPORT_EMAIL } from "@/lib/constants";

export function TopBar({
  displayName,
  unreadCount = 0,
}: {
  displayName: string;
  unreadCount?: number;
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
      <Link
        href="/it/notifications"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700"
        title={displayName}
      >
        {initials}
      </div>
    </div>
  );
}
