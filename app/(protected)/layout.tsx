import { Suspense } from "react";
import { SubmitGuard } from "@/components/submit-guard";
import { FormFeedback } from "@/components/form-feedback";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { getCurrentUserNav } from "./current-user";
import { getRecentNotifications } from "./notification-actions";
import { getNavExtras } from "./hr/clearance/clearance-nav";

// Route group (URL-invisible) wrapping every page that requires a signed-in, role-assigned
// user: /home, /hr/dashboard, /it/dashboard, /admin/*, /profile/*. /login, /pending-setup,
// /unauthorized, and /auth/callback stay outside this group — no sidebar makes sense there.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ displayName, permissions, homePath }, { unreadCount, notifications }, navExtras] =
    await Promise.all([getCurrentUserNav(), getRecentNotifications(), getNavExtras()]);
  // Menu-only flags (Clearance for real signers, My Tasks for anyone with open work) and the
  // number on My Tasks; see clearance-nav.ts.
  const navKeys = [...permissions, ...navExtras.keys];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Stops double clicks from saving a form twice, on every page. */}
      <Suspense fallback={null}>
        <SubmitGuard />
        {/* Pop-up for every save: done, not saved (and why), or still saving. */}
        <FormFeedback />
      </Suspense>
      {/* Sidebar sits in normal flex flow (not fixed) so its own width transition pushes/pulls
          this content area as it expands and collapses on hover. It's already its own h-screen,
          independently scrolling column (see sidebar.tsx) — the outer h-screen + overflow-hidden
          here is what stops the *page* from scrolling, so the sidebar and TopBar stay put and
          only <main> scrolls. */}
      <Sidebar permissions={navKeys} homePath={homePath} taskCount={navExtras.taskCount}
        clearanceCount={navExtras.clearanceCount}
      />
      {/* min-w-0: without it this column grows to fit its widest content (a wide table), pushing
          the page wider than the window: sideways scrolling and a white strip past the grey. */}
      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar displayName={displayName} unreadCount={unreadCount} notifications={notifications} />
        <main className="flex-1 overflow-y-auto px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
