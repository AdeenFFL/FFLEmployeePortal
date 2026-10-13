import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/it/tickets";
import { markAllNotificationsRead } from "./actions";
import { cardClass, secondaryButtonClass } from "../_components/ticket-ui";

// The portal inbox behind the top-bar bell (javaria_it_0003_notifications.sql). RLS shows each
// person only their own notifications.
export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: notifications } = await supabase
    .schema("it")
    .from("notifications")
    .select("id, title, body, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = notifications ?? [];
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="py-6">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up."}
        action={
          unread > 0 ? (
            <form action={markAllNotificationsRead}>
              <button type="submit" className={secondaryButtonClass}>
                Mark all as read
              </button>
            </form>
          ) : undefined
        }
      />

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id}>
                {/* Route handler: marks read, then redirects to the ticket / request. */}
                <a
                  href={`/it/notifications/${n.id}`}
                  className={`flex gap-3 px-6 py-4 hover:bg-slate-50 ${n.read_at ? "" : "bg-blue-50/40"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-blue-600"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm ${n.read_at ? "text-slate-700" : "font-semibold text-slate-900"}`}
                    >
                      {n.title}
                      {!n.read_at && <span className="sr-only"> (unread)</span>}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block truncate text-sm text-slate-500">{n.body}</span>
                    )}
                    <span className="mt-1 block text-xs text-slate-400">
                      {formatDateTime(n.created_at)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
