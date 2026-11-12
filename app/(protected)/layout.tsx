import { Suspense } from "react";
import { SubmitGuard } from "@/components/submit-guard";
import { FormFeedback } from "@/components/form-feedback";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { getCurrentUserNav } from "./current-user";
import { getRecentNotifications } from "./notification-actions";

// Route group (URL-invisible) wrapping every page that requires a signed-in, role-assigned
// user: /home, /hr/dashboard, /it/dashboard, /admin/*, /profile/*. /login, /pending-setup,
// /unauthorized, and /auth/callback stay outside this group — no sidebar makes sense there.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ displayName, permissions, homePath }, { unreadCount, notifications }] =
    await Promise.all([getCurrentUserNav(), getRecentNotifications()]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Stops double clicks from saving a form twice, on every page. */}
      <Suspense fallback={null}>
        <SubmitGuard />
        {/* Pop-up for every save: done, not saved (and why), or still saving. */}
        <FormFeedback />
      </Suspense>
      {/* Sidebar sits in normal flex flow (not fixed) so its own width transition pushes/pulls
          this content area as it expands and collapses on hover. */}
      <Sidebar permissions={permissions} homePath={homePath} />
      {/* min-w-0: without it this column grows to fit its widest content (a wide table), pushing
          the page wider than the window: sideways scrolling and a white strip past the grey. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar displayName={displayName} unreadCount={unreadCount} notifications={notifications} />
        <main className="flex-1 px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
