import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import {
  fetchCategoryMaps,
  fetchOrgUnits,
  fetchPersonNames,
  signedAttachmentUrls,
} from "@/lib/it/ticket-data";
import { formatDateTime } from "@/lib/it/tickets";
import { addRequesterComment, confirmResolution, reopenTicket } from "../actions";
import {
  AttachmentList,
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  PriorityBadge,
  primaryButtonClass,
  secondaryButtonClass,
  StatusBadge,
  Timeline,
} from "../../_components/ticket-ui";

// SCR-02 detail — the requester's view. RLS ("tickets select own, assigned, or it staff")
// scopes the ticket, and "ticket_updates select" hides internal work notes from requesters.
export default async function MyItTicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, { notice, error }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .schema("it")
    .from("tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();

  const [{ data: updates }, { data: attachments }, maps, orgUnits] = await Promise.all([
    supabase
      .schema("it")
      .from("ticket_updates")
      .select("*")
      .eq("ticket_id", id)
      .eq("is_internal", false)
      .order("created_at"),
    supabase
      .schema("it")
      .from("ticket_attachments")
      .select("id, storage_path, file_name, size_bytes")
      .eq("ticket_id", id)
      .order("created_at"),
    fetchCategoryMaps(supabase),
    fetchOrgUnits(supabase),
  ]);

  const [names, urls] = await Promise.all([
    fetchPersonNames(supabase, [
      ticket.assigned_to_person_id,
      ...(updates ?? []).map((u) => u.author_person_id),
    ]),
    signedAttachmentUrls(supabase, (attachments ?? []).map((a) => a.storage_path)),
  ]);

  const awaitingConfirmation = ticket.status === "Resolved" && !ticket.requester_confirmed_at;
  const isClosed = ticket.status === "Closed";

  return (
    <div className="py-6">
      <PageHeader
        title={`${ticket.ticket_number} · ${ticket.subject}`}
        description={`Raised ${formatDateTime(ticket.created_at)}`}
        action={
          <Link href="/it/my-tickets" className={secondaryButtonClass}>
            Back to my tickets
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{ticket.description}</p>
            {(attachments ?? []).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Attachments
                </p>
                <AttachmentList attachments={attachments ?? []} urls={urls} />
              </div>
            )}
          </section>

          {ticket.resolution_notes && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
              <p className="mb-1 text-sm font-semibold text-emerald-800">Resolution from IT</p>
              <p className="whitespace-pre-wrap text-sm text-emerald-900">
                {ticket.resolution_notes}
              </p>
              {ticket.resolved_at && (
                <p className="mt-2 text-xs text-emerald-700">
                  Resolved {formatDateTime(ticket.resolved_at)}
                </p>
              )}
            </section>
          )}

          {awaitingConfirmation && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">
                Is your issue resolved?
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                Confirm the fix so IT can close the ticket, or reopen it if the problem is still
                there.
              </p>
              <div className="grid gap-6 md:grid-cols-2">
                <form action={confirmResolution.bind(null, ticket.id)} className="space-y-3">
                  <fieldset>
                    <legend className={labelClass}>How was the support?</legend>
                    <div className="flex gap-3">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <label key={n} className="flex items-center gap-1 text-sm text-slate-700">
                          <input type="radio" name="rating" value={n} required />
                          {n}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">1 = poor, 5 = excellent</p>
                  </fieldset>
                  <textarea
                    name="comment"
                    rows={2}
                    placeholder="Any feedback (optional)"
                    className={inputClass}
                  />
                  <button type="submit" className={primaryButtonClass}>
                    Yes, it&apos;s resolved
                  </button>
                </form>
                <form action={reopenTicket.bind(null, ticket.id)} className="space-y-3">
                  <label htmlFor="reason" className={labelClass}>
                    Still a problem?
                  </label>
                  <textarea
                    id="reason"
                    name="reason"
                    required
                    rows={3}
                    placeholder="What's still not working?"
                    className={inputClass}
                  />
                  <button type="submit" className={secondaryButtonClass}>
                    Reopen ticket
                  </button>
                </form>
              </div>
            </section>
          )}

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Updates</h2>
            <Timeline updates={updates ?? []} names={names} />

            {!isClosed && (
              <form
                action={addRequesterComment.bind(null, ticket.id)}
                className="mt-4 border-t border-slate-100 pt-4"
              >
                <label htmlFor="body" className="sr-only">
                  Add a comment
                </label>
                <textarea
                  id="body"
                  name="body"
                  required
                  rows={3}
                  placeholder="Add a comment for IT…"
                  className={`${inputClass} mb-2`}
                />
                <button type="submit" className={primaryButtonClass}>
                  Add comment
                </button>
              </form>
            )}
          </section>
        </div>

        <aside className={`${cardClass} h-fit p-6`}>
          <dl className="space-y-4">
            <Fact label="Request type">
              {maps.requestTypeNameById.get(ticket.request_type_id) ?? "—"}
            </Fact>
            <Fact label="Category">
              {(ticket.category_id && maps.categoryNameById.get(ticket.category_id)) ?? "—"}
              {ticket.subcategory_id && ` / ${maps.categoryNameById.get(ticket.subcategory_id) ?? ""}`}
            </Fact>
            <Fact label="Assigned to">
              {ticket.assigned_to_person_id
                ? (names.get(ticket.assigned_to_person_id) ?? "IT Team")
                : "Not yet assigned"}
            </Fact>
            <Fact label="Target resolution">{formatDateTime(ticket.resolution_due_at)}</Fact>
            <Fact label="Location">
              {(ticket.site_id && orgUnits.nameById.get(ticket.site_id)) ?? "—"}
            </Fact>
            <Fact label="Department">
              {(ticket.department_id && orgUnits.nameById.get(ticket.department_id)) ?? "—"}
            </Fact>
            {ticket.asset_system_name && (
              <Fact label="Asset / system">{ticket.asset_system_name}</Fact>
            )}
            {ticket.access_required && <Fact label="Access required">{ticket.access_required}</Fact>}
            <Fact label="Preferred contact">{ticket.preferred_contact_method}</Fact>
            {ticket.requester_confirmed_at && (
              <Fact label="You confirmed">
                {formatDateTime(ticket.requester_confirmed_at)}
                {ticket.satisfaction_rating && ` · ${ticket.satisfaction_rating}/5`}
              </Fact>
            )}
            {ticket.closed_at && <Fact label="Closed">{formatDateTime(ticket.closed_at)}</Fact>}
          </dl>
        </aside>
      </div>
    </div>
  );
}
