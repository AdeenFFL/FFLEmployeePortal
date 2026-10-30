"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "@/components/icons";
import { getRecentNotifications, type RecentNotification } from "@/app/(protected)/notification-actions";

const POLL_MS = 30_000;

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Hover (desktop) or click (anywhere, including touch) opens the popover; polls every 30s so a
// new notification's badge/preview shows up without a full page reload. Clicking an item reuses
// the existing /it/notifications/[id] route handler, which marks it read then redirects — this
// component doesn't duplicate that logic.
export function NotificationBell({
  initialUnreadCount,
  initialNotifications,
}: {
  initialUnreadCount: number;
  initialNotifications: RecentNotification[];
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState(initialNotifications);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = setInterval(async () => {
      // A missed poll (server restarting, laptop waking up, network blip) must not surface as an
      // error — keep the last counts and try again on the next tick.
      try {
        const result = await getRecentNotifications();
        setUnreadCount(result.unreadCount);
        setNotifications(result.notifications);
      } catch {
        // ignore; next poll retries
      }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-slate-400">{unreadCount} unread</span>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <a
                    href={`/it/notifications/${n.id}`}
                    className={`flex gap-2 px-4 py-3 text-sm hover:bg-slate-50 ${n.read_at ? "" : "bg-blue-50/40"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-blue-600"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate ${n.read_at ? "text-slate-700" : "font-semibold text-slate-900"}`}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{n.body}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-slate-400">{timeAgo(n.created_at)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/it/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-blue-600 hover:bg-slate-50"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
