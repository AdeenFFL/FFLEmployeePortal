"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BellIcon, CheckIcon } from "@/components/icons";
import { notificationKind } from "@/lib/it/notification-kinds";
import {
  getRecentNotifications,
  markAllRead,
  markNotificationRead,
  type RecentNotification,
} from "@/app/(protected)/notification-actions";

const POLL_MS = 30_000;

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

// The bell lists only what you haven't opened. Opening one (the /it/notifications/[id] route marks
// it read, then goes to what it's about), ticking it off, or "Mark all read" takes it off the
// list. Everything stays on the full Notifications page. Hover (desktop) or click (touch) opens
// it; it checks for new ones every 30s.
export function NotificationBell({
  initialUnreadCount,
  initialNotifications,
}: {
  initialUnreadCount: number;
  initialNotifications: RecentNotification[];
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState(
    initialNotifications.filter((n) => !n.read_at),
  );
  // Ticked off here but maybe not yet saved when a poll comes back: keep them hidden.
  const dismissed = useRef(new Set<string>());
  const [, startTransition] = useTransition();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = setInterval(async () => {
      // A missed poll (server restarting, laptop waking up, network blip) must not surface as an
      // error: keep the last list and try again on the next tick.
      try {
        const result = await getRecentNotifications();
        const fresh = result.notifications.filter((n) => !dismissed.current.has(n.id));
        setNotifications(fresh);
        // Ones ticked off here whose save hasn't landed yet still count on the server.
        setUnreadCount(Math.max(fresh.length, result.unreadCount - (result.notifications.length - fresh.length)));
      } catch {
        // ignore; next poll retries
      }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  // The sidebar's red counts follow the same notifications (sidebar.tsx listens for this).
  function announce() {
    window.dispatchEvent(new Event("notifications:changed"));
  }

  function removeLocally(id: string) {
    dismissed.current.add(id);
    setNotifications((list) => list.filter((n) => n.id !== id));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  function tickOff(id: string) {
    removeLocally(id);
    startTransition(async () => {
      await markNotificationRead(id);
      announce();
    });
  }

  function clearAll() {
    for (const n of notifications) dismissed.current.add(n.id);
    setNotifications([]);
    setUnreadCount(0);
    startTransition(async () => {
      await markAllRead();
      announce();
    });
  }

  const today = notifications.filter((n) => isToday(n.created_at));
  const earlier = notifications.filter((n) => !isToday(n.created_at));
  const hidden = Math.max(0, unreadCount - notifications.length);

  function renderItem(n: RecentNotification) {
    const kind = notificationKind(n);
    const KindIcon = kind.icon;
    return (
      <li key={n.id} className="group relative">
        <a
          href={`/it/notifications/${n.id}`}
          onClick={() => removeLocally(n.id)}
          className="flex gap-3 rounded-xl px-3 py-3 pr-11 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${kind.chip}`}>
            <KindIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{n.title}</span>
            {n.body && (
              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{n.body}</span>
            )}
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="font-medium text-slate-500">{kind.label}</span>
              <span aria-hidden="true">·</span>
              <span>{timeAgo(n.created_at)}</span>
            </span>
          </span>
        </a>
        <span aria-hidden="true" className="absolute right-4 top-4 h-2 w-2 rounded-full bg-blue-600 group-hover:opacity-0" />
        <button
          type="button"
          onClick={() => tickOff(n.id)}
          aria-label={`Mark "${n.title}" as read`}
          title="Mark as read"
          className="absolute right-2 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 opacity-0 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <CheckIcon className="h-4 w-4" />
        </button>
      </li>
    );
  }

  function section(label: string, items: RecentNotification[]) {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <ul className="space-y-0.5 px-2">{items.map(renderItem)}</ul>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} new` : "Notifications"}
        aria-expanded={open}
        className={`relative rounded-full p-2 transition-colors ${
          open ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        }`}
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-slate-50">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  {unreadCount} new
                </span>
              )}
            </div>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-slate-900">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-slate-500">New notifications will show up here.</p>
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto pb-2">
              {section("Today", today)}
              {section("Earlier", earlier)}
              {hidden > 0 && (
                <p className="px-5 pt-2 text-xs text-slate-400">
                  {hidden} more on the Notifications page.
                </p>
              )}
            </div>
          )}

          <Link
            href="/it/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-center text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
