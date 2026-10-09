import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export default async function HrDashboardPage() {
  const supabase = await createClient();

  const [{ data: canManageTickets }, { data: canManageFeedback }] = await Promise.all([
    supabase.rpc("has_permission", { p_permission_key: "hr.manage_tickets" }),
    supabase.rpc("has_permission", { p_permission_key: "hr.manage_anonymous_feedback" }),
  ]);

  // RLS scopes each count to exactly what this viewer is allowed to see — canManage* just
  // decides whether to render the card at all (someone with neither sees an empty dashboard
  // rather than two cards that would always read zero).
  const [{ count: openTickets }, { count: openConversations }] = await Promise.all([
    canManageTickets
      ? supabase
          .schema("hr")
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .neq("status", "Closed")
      : Promise.resolve({ count: null }),
    canManageFeedback
      ? supabase
          .schema("hr")
          .from("anonymous_conversations")
          .select("id", { count: "exact", head: true })
          .eq("status", "Open")
      : Promise.resolve({ count: null }),
  ]);

  return (
    <div className="py-6">
      <PageHeader title="HR Dashboard" description="Your HR operations overview." />

      <div className="grid gap-4 sm:grid-cols-2">
        {canManageTickets && (
          <Link
            href="/hr/feedback"
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300"
          >
            <p className="text-sm text-slate-500">Open Tickets</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{openTickets ?? 0}</p>
            <p className="mt-2 text-sm text-blue-600">View ticket queue →</p>
          </Link>
        )}
        {canManageFeedback && (
          <Link
            href="/hr/feedback/anonymous"
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-300"
          >
            <p className="text-sm text-slate-500">Open Anonymous Conversations</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{openConversations ?? 0}</p>
            <p className="mt-2 text-sm text-blue-600">View anonymous queue →</p>
          </Link>
        )}
        {!canManageTickets && !canManageFeedback && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm sm:col-span-2">
            <p className="text-sm text-slate-500">
              You don't currently hold any HR-staff permissions (hr.manage_tickets or
              hr.manage_anonymous_feedback). Contact an admin via Permission Groups if this
              seems wrong.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
