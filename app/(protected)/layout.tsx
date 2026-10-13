import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { getCurrentUserNav } from "./current-user";
import { createClient } from "@/lib/supabase/server";

// Unread count for the top-bar bell. IT is the only module with an inbox so far
// (javaria_it_0003_notifications.sql); any failure (e.g. schema not exposed) just hides the badge.
async function getUnreadNotificationCount() {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .schema("it")
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

// Route group (URL-invisible) wrapping every page that requires a signed-in, role-assigned
// user: /home, /hr/dashboard, /it/dashboard, /admin/*, /profile/*. /login, /pending-setup,
// /unauthorized, and /auth/callback stay outside this group — no sidebar makes sense there.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ displayName, permissions, homePath }, unreadCount] = await Promise.all([
    getCurrentUserNav(),
    getUnreadNotificationCount(),
  ]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar sits in normal flex flow (not fixed) so its own width transition pushes/pulls
          this content area as it expands and collapses on hover. */}
      <Sidebar permissions={permissions} homePath={homePath} />
      <div className="flex flex-1 flex-col">
        <TopBar displayName={displayName} unreadCount={unreadCount} />
        <main className="flex-1 px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
