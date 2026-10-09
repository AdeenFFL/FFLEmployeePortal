import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { deleteTicket } from "./actions";
import type { TicketStatus } from "@/types/database";

const STATUS_STYLES: Record<string, string> = {
  Open: "bg-blue-50 text-blue-700",
  "In Progress": "bg-amber-50 text-amber-700",
  Resolved: "bg-green-50 text-green-700",
  Closed: "bg-slate-100 text-slate-500",
};

const STATUS_OPTIONS: TicketStatus[] = ["Open", "In Progress", "Resolved", "Closed"];

export default async function HrFeedbackQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  // RLS ("tickets select own or hr staff") already scopes this to every ticket once the
  // viewer has hr.tickets.read — no client-side person_id filter needed here. persons(...) is
  // intentionally not embedded: hr.tickets.person_id -> public.persons is a cross-schema FK,
  // which supabase-js can't type (see types/database.ts's note on anonymous_conversations) —
  // names are fetched separately below instead.
  let query = supabase
    .schema("hr")
    .from("tickets")
    .select("id, subject, status, created_at, person_id, ticket_categories(name)");
  if (status && STATUS_OPTIONS.includes(status as TicketStatus)) {
    query = query.eq("status", status as TicketStatus);
  }
  const { data: tickets } = await query.order("created_at", { ascending: false });

  const personIds = [...new Set((tickets ?? []).map((t) => t.person_id))];
  const { data: people } =
    personIds.length > 0
      ? await supabase.from("persons").select("id, full_name").in("id", personIds)
      : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  const { data: canDelete } = await supabase.rpc("has_permission", {
    p_permission_key: "hr.tickets.delete",
  });

  return (
    <div className="py-6">
      <PageHeader
        title="Ticket Queue"
        description="All employee tickets across every category."
      />

      <div className="mb-4 flex gap-2">
        {["", "Open", "In Progress", "Resolved", "Closed"].map((s) => (
          <Link
            key={s}
            href={s ? `/hr/feedback?status=${s}` : "/hr/feedback"}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              (status ?? "") === s
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s || "All"}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {(tickets ?? []).length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No tickets found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(tickets ?? []).map((t) => {
              const deleteAction = deleteTicket.bind(null, t.id);
              return (
                <li key={t.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50">
                  <Link href={`/hr/tickets/${t.id}`} className="flex flex-1 items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t.subject}</p>
                      <p className="text-xs text-slate-400">
                        {nameById.get(t.person_id) ?? "Unknown"} ·{" "}
                        {t.ticket_categories?.name ?? "General"} ·{" "}
                        {new Date(t.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        STATUS_STYLES[t.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {t.status}
                    </span>
                  </Link>
                  {canDelete && (
                    <form action={deleteAction} className="ml-4">
                      <button
                        type="submit"
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
