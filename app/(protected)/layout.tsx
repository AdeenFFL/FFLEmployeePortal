import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { getCurrentUserNav } from "./current-user";

// Route group (URL-invisible) wrapping every page that requires a signed-in, role-assigned
// user: /home, /hr/dashboard, /it/dashboard, /admin/*, /profile/*. /login, /pending-setup,
// /unauthorized, and /auth/callback stay outside this group — no sidebar makes sense there.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { displayName, permissions, homePath } = await getCurrentUserNav();

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar sits in normal flex flow (not fixed) so its own width transition pushes/pulls
          this content area as it expands and collapses on hover. */}
      <Sidebar permissions={permissions} homePath={homePath} />
      <div className="flex flex-1 flex-col">
        <TopBar displayName={displayName} />
        <main className="flex-1 px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
