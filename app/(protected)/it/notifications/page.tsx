import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { CheckIcon } from "@/components/icons";
import { checked } from "@/lib/it/ticket-data";
import {
  NOTIFICATION_CATEGORY_ORDER,
  NOTIFICATION_KINDS,
  notificationCategory,
  type NotificationCategory,
} from "@/lib/it/notification-kinds";
import { markNotificationRead } from "../../notification-actions";
import { markAllNotificationsRead } from "./actions";
import { cardClass, inputClass, secondaryButtonClass } from "../_components/ticket-ui";

const LIMIT = 300;
const SHOWS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
] as const;
type Show = (typeof SHOWS)[number]["key"];

// Karachi is the business day for everyone using the portal.
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

// The portal inbox behind the top-bar bell (javaria_it_0003_notifications.sql). RLS shows each
// person only their own notifications. Filter by category (worked out by lib/it/notification-kinds),
// read / unread, and search the title and text.
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; show?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const show: Show = SHOWS.find((s) => s.key === sp.show)?.key ?? "all";
  const cat = (NOTIFICATION_CATEGORY_ORDER as string[]).includes(sp.cat ?? "")
    ? (sp.cat as NotificationCategory)
    : null;

  const supabase = await createClient();
  let query = supabase
    .schema("it")
    .from("notifications")
    .select("id, event, title, body, read_at, created_at, ticket_id, request_id, demand_id, invoice_id")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  // Characters that would break the PostgREST or() filter, and LIKE wildcards, are dropped.
  const term = q.replace(/[%_,()*\\]/g, " ").trim();
  if (term) query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  const [{ data: notifications }, { count: unreadTotal }] = await Promise.all([
    query.then(checked),
    supabase
      .schema("it")
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  // Category counts follow the search and read filter, so each tab says what it would show.
  const all = (notifications ?? []).map((n) => ({ ...n, category: notificationCategory(n) }));
  const byShow = all.filter((n) => (show === "unread" ? !n.read_at : show === "read" ? Boolean(n.read_at) : true));
  const counts = new Map<NotificationCategory, number>();
  for (const n of byShow) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
  const rows = cat ? byShow.filter((n) => n.category === cat) : byShow;

  // Today / Yesterday / then by date.
  const now = new Date();
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const groups: { label: string; items: typeof rows }[] = [];
  for (const n of rows) {
    const key = dayKey(n.created_at);
    const label = key === today ? "Today" : key === yesterday ? "Yesterday" : dateOf(n.created_at);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const href = (next: { q?: string; cat?: string | null; show?: string }) => {
    const params = new URLSearchParams();
    const nq = next.q ?? q;
    const ncat = next.cat === undefined ? cat : next.cat;
    const nshow = next.show ?? show;
    if (nq) params.set("q", nq);
    if (ncat) params.set("cat", ncat);
    if (nshow !== "all") params.set("show", nshow);
    const qs = params.toString();
    return `/it/notifications${qs ? `?${qs}` : ""}`;
  };
  const filtered = Boolean(q || cat || show !== "all");
  const unread = unreadTotal ?? 0;

  return (
    <div className="py-6">
      <PageHeader
        title="Notifications"
        description={
          unread
            ? `${unread} new · open one to go to what it's about`
            : "You're all caught up."
        }
        action={
          unread > 0 ? (
            <form action={markAllNotificationsRead}>
              <button type="submit" className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}>
                <CheckIcon className="h-4 w-4" />
                Mark all as read
              </button>
            </form>
          ) : undefined
        }
      />

      {/* Search + read filter */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form method="get" className="relative flex-1" role="search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search notifications, e.g. ONB-000057, laptop, demand…"
            aria-label="Search notifications"
            className={`${inputClass} bg-white pl-9`}
          />
          {cat && <input type="hidden" name="cat" value={cat} />}
          {show !== "all" && <input type="hidden" name="show" value={show} />}
        </form>
        <nav aria-label="Read or unread" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1">
          {SHOWS.map((s) => (
            <Link
              key={s.key}
              href={href({ show: s.key })}
              aria-current={show === s.key ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                show === s.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {s.label}
              {s.key === "unread" && unread > 0 && (
                <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>

      {/* Categories */}
      <nav aria-label="Categories" className="mb-5 flex flex-wrap gap-2">
        <Link
          href={href({ cat: null })}
          aria-current={!cat ? "page" : undefined}
          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            !cat ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          All
          <span className={`text-xs ${!cat ? "text-slate-300" : "text-slate-400"}`}>{byShow.length}</span>
        </Link>
        {NOTIFICATION_CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0 || c === cat).map((c) => {
          const kind = NOTIFICATION_KINDS[c];
          const KindIcon = kind.icon;
          const active = cat === c;
          return (
            <Link
              key={c}
              href={href({ cat: c })}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors ${
                active ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${kind.chip}`}>
                <KindIcon className="h-3.5 w-3.5" />
              </span>
              {kind.label}
              <span className={`text-xs ${active ? "text-slate-300" : "text-slate-400"}`}>{counts.get(c) ?? 0}</span>
            </Link>
          );
        })}
      </nav>

      {/* List */}
      {rows.length === 0 ? (
        <div className={`${cardClass} flex flex-col items-center px-6 py-14 text-center`}>
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <CheckIcon className="h-6 w-6" />
          </span>
          <p className="text-sm font-semibold text-slate-900">
            {q
              ? `Nothing matches “${q}”`
              : show === "unread"
                ? "No unread notifications"
                : filtered
                  ? "Nothing here"
                  : "No notifications yet"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {filtered ? "Try another category or search." : "When something needs you, it shows up here."}
          </p>
          {filtered && (
            <Link href="/it/notifications" className="mt-4 text-sm font-medium text-blue-700 hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {g.label}
              </h2>
              <ul className={`${cardClass} divide-y divide-slate-100 overflow-hidden`}>
                {g.items.map((n) => {
                  const kind = NOTIFICATION_KINDS[n.category];
                  const KindIcon = kind.icon;
                  const isUnread = !n.read_at;
                  return (
                    <li key={n.id} className={`group relative ${isUnread ? "bg-blue-50/40" : ""}`}>
                      {isUnread && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-blue-600" />}
                      {/* Route handler: marks read, then redirects to the ticket / request / demand. */}
                      <a
                        href={`/it/notifications/${n.id}`}
                        className="flex gap-4 px-5 py-4 pr-14 transition-colors hover:bg-slate-50"
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${kind.chip}`}>
                          <KindIcon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-sm ${isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}
                            >
                              {n.title}
                            </span>
                            {isUnread && (
                              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                New
                              </span>
                            )}
                          </span>
                          {n.body && (
                            <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-500">{n.body}</span>
                          )}
                          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                            <span className="font-medium text-slate-500">{kind.label}</span>
                            <span aria-hidden="true">·</span>
                            <span>{timeOf(n.created_at)}</span>
                          </span>
                        </span>
                      </a>
                      {isUnread && (
                        <form action={markNotificationRead.bind(null, n.id)} className="absolute right-3 top-4">
                          <button
                            type="submit"
                            title="Mark as read"
                            aria-label={`Mark "${n.title}" as read`}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 opacity-0 transition hover:bg-blue-100 hover:text-blue-700 focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <CheckIcon className="h-4 w-4" />
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {(notifications ?? []).length >= LIMIT && (
            <p className="px-1 text-xs text-slate-400">
              Showing the latest {LIMIT}. Search to find older ones.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
