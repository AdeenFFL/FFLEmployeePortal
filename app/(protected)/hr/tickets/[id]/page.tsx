import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { replyToTicket } from "../actions";
import { updateTicketStatus, deleteTicket } from "../../feedback/actions";
import { HR_STATUS_TONE } from "../page";
import { cardClass, Fact, inputClass, primaryButtonClass } from "../../../it/_components/ticket-ui";

const STATUSES = ["Open", "In Progress", "Resolved", "Closed"];

// Two-column layout matching IT's ticket workspace convention (app/(protected)/it/tickets/[id]/
// page.tsx) — main column is the thread, side column is Fact-based metadata. hr.ticket_messages
// has no update_type/internal-note distinction the way it.ticket_updates does, so this keeps its
// own small message-thread rendering instead of reusing IT's Timeline component, which assumes
// that field exists.
export default async function TicketThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS ("tickets select own or hr staff") already scopes this to either the submitter or
  // someone with hr.tickets.read — a mismatched id resolves to no row either way.
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

  const [{ data: canUpdate }, { data: canDelete }] = await Promise.all([
    supabase.rpc("has_permission", { p_permission_key: "hr.tickets.update" }),
    supabase.rpc("has_permission", { p_permission_key: "hr.tickets.delete" }),
  ]);

  const replyAction = replyToTicket.bind(null, id);
  const statusAction = updateTicketStatus.bind(null, id);
  const deleteAction = deleteTicket.bind(null, id);

  return (
    <div className="py-6">
      <PageHeader title={ticket.subject} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className={`${cardClass} p-6`}>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{ticket.body}</p>
            <p className="mt-3 text-xs text-slate-400">
              Submitted {new Date(ticket.created_at).toLocaleString()}
            </p>
          </section>

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Replies</h2>
            <div className="flex flex-col gap-3">
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
              <form action={replyAction} className="mt-4 border-t border-slate-100 pt-4">
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Write a reply…"
                  className={`${inputClass} mb-2`}
                />
                <button type="submit" className={primaryButtonClass}>
                  Reply
                </button>
              </form>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className={`${cardClass} p-5`}>
            <dl className="space-y-4">
              <Fact label="Status">
                <StatusPill label={ticket.status} tone={HR_STATUS_TONE[ticket.status] ?? "neutral"} />
              </Fact>
              <Fact label="Category">{ticket.ticket_categories?.name ?? "General"}</Fact>
            </dl>
          </section>

          {(canUpdate || canDelete) && (
            <section className={`${cardClass} p-5 space-y-4`}>
              {canUpdate && (
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
                    Update
                  </button>
                </form>
              )}
              {canDelete && (
                <form action={deleteAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete ticket
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
