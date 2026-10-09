import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { replyToTicket } from "../actions";
import { updateTicketStatus } from "../../feedback/actions";

const STATUSES = ["Open", "In Progress", "Resolved", "Closed"];

export default async function TicketThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS ("tickets select own or hr staff") already scopes this to either the submitter or
  // someone with hr.manage_tickets — a mismatched id resolves to no row either way.
  const { data: ticket } = await supabase
    .schema("hr")
    .from("tickets")
    .select("id, subject, body, status, created_at, ticket_categories(name)")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();

  // persons(...) isn't embedded here: sender_person_id -> public.persons is a cross-schema FK,
  // which supabase-js can't type (see types/database.ts's note on anonymous_conversations) —
  // names are fetched separately below instead.
  const { data: messages } = await supabase
    .schema("hr")
    .from("ticket_messages")
    .select("id, sender_person_id, body, created_at")
    .eq("ticket_id", id)
    .order("created_at");

  const senderIds = [...new Set((messages ?? []).map((m) => m.sender_person_id))];
  const { data: senders } =
    senderIds.length > 0
      ? await supabase.from("persons").select("id, full_name").in("id", senderIds)
      : { data: [] };
  const senderNameById = new Map((senders ?? []).map((p) => [p.id, p.full_name]));

  const { data: canManage } = await supabase.rpc("has_permission", {
    p_permission_key: "hr.manage_tickets",
  });

  const replyAction = replyToTicket.bind(null, id);
  const statusAction = updateTicketStatus.bind(null, id);

  return (
    <div className="py-6">
      <PageHeader
        title={ticket.subject}
        description={`${ticket.ticket_categories?.name ?? "General"} · ${ticket.status}`}
        action={
          canManage ? (
            <form action={statusAction} className="flex items-center gap-2">
              <select
                name="status"
                defaultValue={ticket.status}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Update Status
              </button>
            </form>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.body}</p>
          <p className="mt-2 text-xs text-slate-400">
            Submitted {new Date(ticket.created_at).toLocaleString()}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-4">
          {(messages ?? []).map((m) => (
            <div key={m.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="text-slate-700">{m.body}</p>
              <p className="mt-1 text-xs text-slate-400">
                {senderNameById.get(m.sender_person_id) ?? "Unknown"} ·{" "}
                {new Date(m.created_at).toLocaleString()}
              </p>
            </div>
          ))}
          {(messages ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No replies yet.</p>
          )}
        </div>

        {ticket.status !== "Closed" && (
          <form action={replyAction} className="border-t border-slate-200 p-4">
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Write a reply…"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Reply
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
