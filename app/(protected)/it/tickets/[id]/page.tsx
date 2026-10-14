import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  fetchAssetLabels,
  fetchCategoryMaps,
  fetchOrgUnits,
  fetchPersonNames,
  hasItPermission,
  signedAttachmentUrls,
} from "@/lib/it/ticket-data";
import {
  formatDateTime,
  TASK_STATUS_TONE,
  TASK_STATUSES,
  TICKET_PRIORITIES,
  WORKING_STATUSES,
} from "@/lib/it/tickets";
import {
  addStaffUpdate,
  addTask,
  closeTicket,
  resolveTicket,
  setEscalation,
  setTicketAsset,
  triageTicket,
  updateTaskStatus,
  updateTicketStatus,
} from "../actions";
import { CategorySelect } from "../../_components/category-select";
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
  SlaBadge,
  StatusBadge,
  Timeline,
} from "../../_components/ticket-ui";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-5`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

// SCR-03 detail — IT workspace for one ticket (BRD §5.3.4–5.3.15). Controls are shown only
// to people whose permissions allow them; the database enforces the same rules regardless.
export default async function ItTicketWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string; assetQ?: string }>;
}) {
  const [{ id }, { notice, error, assetQ }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .schema("it")
    .from("tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();

  const [
    { data: updates },
    { data: tasks },
    { data: attachments },
    { data: staff },
    { data: personId },
    maps,
    orgUnits,
    canUpdate,
    canAssign,
    canClose,
  ] = await Promise.all([
    supabase.schema("it").from("ticket_updates").select("*").eq("ticket_id", id).order("created_at"),
    supabase.schema("it").from("ticket_tasks").select("*").eq("ticket_id", id).order("created_at"),
    supabase
      .schema("it")
      .from("ticket_attachments")
      .select("id, storage_path, file_name, size_bytes")
      .eq("ticket_id", id)
      .order("created_at"),
    supabase.schema("it").rpc("list_it_staff"),
    supabase.rpc("current_person_id"),
    fetchCategoryMaps(supabase),
    fetchOrgUnits(supabase),
    hasItPermission(supabase, "it.tickets.update"),
    hasItPermission(supabase, "it.tickets.assign"),
    hasItPermission(supabase, "it.tickets.close"),
  ]);

  const isClosed = ticket.status === "Closed";
  const isAssignee = Boolean(personId) && ticket.assigned_to_person_id === personId;
  const canWork = !isClosed && canUpdate && (isAssignee || canAssign);
  const canComment = !isClosed && (canUpdate || canAssign);
  // Same rule as the tickets update policy: executives, or the assignee with it.tickets.update.
  const canSetDevice = !isClosed && (canAssign || (canUpdate && isAssignee));

  const [names, urls, assetLabels, { data: assetMatches }] = await Promise.all([
    fetchPersonNames(supabase, [
      ticket.requester_person_id,
      ticket.requested_for_person_id,
      ticket.assigned_to_person_id,
      ticket.escalated_by,
      ...(updates ?? []).map((u) => u.author_person_id),
      ...(tasks ?? []).map((t) => t.assigned_to_person_id),
    ]),
    signedAttachmentUrls(supabase, (attachments ?? []).map((a) => a.storage_path)),
    fetchAssetLabels(supabase, [ticket.linked_asset_id]),
    canSetDevice && assetQ?.trim()
      ? supabase.schema("it").rpc("search_assets_for_ticket", { p_search: assetQ })
      : Promise.resolve({ data: null }),
  ]);

  const nameOf = (pid: string | null) => (pid ? (names.get(pid) ?? "—") : "—");

  return (
    <div className="py-6">
      <PageHeader
        title={`${ticket.ticket_number} · ${ticket.subject}`}
        description={`Raised by ${nameOf(ticket.requester_person_id)} on ${formatDateTime(ticket.created_at)}`}
        action={
          <Link href="/it/tickets" className={secondaryButtonClass}>
            Back to queue
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ---------------- Main column ---------------- */}
        <div className="space-y-6 xl:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <SlaBadge ticket={ticket} />
              {ticket.is_escalated && <StatusPill label="Escalated" tone="negative" />}
              {ticket.reopen_count > 0 && (
                <StatusPill label={`Reopened ×${ticket.reopen_count}`} tone="warning" />
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{ticket.description}</p>
            {ticket.remarks && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-500">
                <span className="font-medium text-slate-600">Remarks: </span>
                {ticket.remarks}
              </p>
            )}
            {(attachments ?? []).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Attachments
                </p>
                <AttachmentList attachments={attachments ?? []} urls={urls} />
              </div>
            )}
          </section>

          {(ticket.resolution_notes || ticket.escalation_reason) && (
            <section className={`${cardClass} space-y-4 p-6`}>
              {ticket.is_escalated && ticket.escalation_reason && (
                <div>
                  <p className="text-sm font-semibold text-red-700">Escalation</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">
                    {ticket.escalation_reason}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {nameOf(ticket.escalated_by)} · {formatDateTime(ticket.escalated_at)}
                  </p>
                </div>
              )}
              {ticket.resolution_notes && (
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Resolution</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">
                    {ticket.resolution_notes}
                  </p>
                  {ticket.root_cause && (
                    <p className="mt-2 text-sm text-slate-600">
                      <span className="font-medium">Root cause: </span>
                      {ticket.root_cause}
                    </p>
                  )}
                </div>
              )}
              {ticket.closure_remarks && (
                <div>
                  <p className="text-sm font-semibold text-slate-700">Closure remarks</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">
                    {ticket.closure_remarks}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Tasks */}
          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Tasks</h2>
            {(tasks ?? []).length === 0 ? (
              <p className="mb-4 text-sm text-slate-400">No tasks on this ticket.</p>
            ) : (
              <ul className="mb-4 divide-y divide-slate-100">
                {(tasks ?? []).map((task) => {
                  const canEditTask =
                    !isClosed &&
                    (canAssign || (canUpdate && task.assigned_to_person_id === personId));
                  return (
                    <li key={task.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{task.task_type}</p>
                        {task.description && (
                          <p className="text-sm text-slate-500">{task.description}</p>
                        )}
                        <p className="text-xs text-slate-400">
                          {nameOf(task.assigned_to_person_id)}
                          {task.completed_at && ` · completed ${formatDateTime(task.completed_at)}`}
                        </p>
                      </div>
                      {canEditTask ? (
                        <form
                          action={updateTaskStatus.bind(null, ticket.id, task.id)}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="status"
                            defaultValue={task.status}
                            aria-label="Task status"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          >
                            {TASK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="text-sm font-medium text-blue-700">
                            Save
                          </button>
                        </form>
                      ) : (
                        <StatusPill label={task.status} tone={TASK_STATUS_TONE[task.status]} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canComment && (
              <form
                action={addTask.bind(null, ticket.id)}
                className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3"
              >
                <input
                  name="taskType"
                  required
                  placeholder="Task, e.g. Replace keyboard"
                  aria-label="Task"
                  className={inputClass}
                />
                <select name="assigneeId" aria-label="Task assignee" className={inputClass} defaultValue="">
                  <option value="">Unassigned</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.person_id} value={s.person_id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
                <input
                  name="description"
                  placeholder="Details (optional)"
                  aria-label="Task details"
                  className={inputClass}
                />
                <div className="md:col-span-3">
                  <button type="submit" className={secondaryButtonClass}>
                    Add task
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Timeline */}
          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Activity</h2>
            <Timeline updates={updates ?? []} names={names} />

            {canComment && (
              <form
                action={addStaffUpdate.bind(null, ticket.id)}
                className="mt-4 space-y-3 border-t border-slate-100 pt-4"
              >
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Write a reply or an internal note…"
                  aria-label="Message"
                  className={inputClass}
                />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="visibility" value="public" defaultChecked />
                    Reply to requester
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="visibility" value="internal" />
                    Internal note (IT only)
                  </label>
                  <button type="submit" className={`${primaryButtonClass} ml-auto`}>
                    Post
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        {/* ---------------- Side column ---------------- */}
        <div className="space-y-6">
          {(ticket.linked_asset_id || canSetDevice) && (
            <Panel title="Device">
              {ticket.linked_asset_id ? (
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-800">
                    {assetLabels.get(ticket.linked_asset_id) ?? "Linked asset"}
                  </p>
                  {canSetDevice && (
                    <form action={setTicketAsset.bind(null, ticket.id)}>
                      <input type="hidden" name="assetId" value="" />
                      <button type="submit" className="text-sm text-slate-500 hover:text-red-600">
                        Unlink
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <p className="mb-3 text-sm text-slate-500">
                  Not linked to an asset
                  {ticket.asset_system_name && ` — requester wrote “${ticket.asset_system_name}”`}.
                </p>
              )}
              {canSetDevice && (
                <>
                  <form method="get" className="flex gap-2">
                    <input
                      name="assetQ"
                      defaultValue={assetQ ?? ""}
                      placeholder="Tag, serial, name or model"
                      aria-label="Search assets"
                      className={inputClass}
                    />
                    <button type="submit" className={secondaryButtonClass}>
                      Search
                    </button>
                  </form>
                  {assetQ?.trim() && (
                    <form action={setTicketAsset.bind(null, ticket.id)} className="mt-3 space-y-2">
                      {(assetMatches ?? []).length === 0 ? (
                        <p className="text-xs text-slate-400">No asset matches “{assetQ}”.</p>
                      ) : (
                        <>
                          {(assetMatches ?? []).map((a) => (
                            <label key={a.asset_id} className="flex items-start gap-2 text-sm">
                              <input type="radio" name="assetId" value={a.asset_id} required className="mt-1" />
                              <span>
                                <span className="font-medium text-slate-800">{a.asset_tag}</span>{" "}
                                {a.asset_name}
                                <span className="block text-xs text-slate-400">
                                  SN {a.serial_number} · {a.status}
                                </span>
                              </span>
                            </label>
                          ))}
                          <button type="submit" className={primaryButtonClass}>
                            Link device
                          </button>
                        </>
                      )}
                    </form>
                  )}
                </>
              )}
            </Panel>
          )}

          {canAssign && !isClosed && (
            <Panel title="Triage">
              <form action={triageTicket.bind(null, ticket.id)} className="space-y-3">
                <div>
                  <label htmlFor="assigneeId" className={labelClass}>
                    Assigned to
                  </label>
                  <select
                    id="assigneeId"
                    name="assigneeId"
                    defaultValue={ticket.assigned_to_person_id ?? ""}
                    className={inputClass}
                  >
                    <option value="">Unassigned</option>
                    {(staff ?? []).map((s) => (
                      <option key={s.person_id} value={s.person_id}>
                        {s.full_name}
                        {s.designation ? ` — ${s.designation}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="priority" className={labelClass}>
                    Priority
                  </label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue={ticket.priority}
                    className={inputClass}
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="requestTypeId" className={labelClass}>
                    Request type
                  </label>
                  <select
                    id="requestTypeId"
                    name="requestTypeId"
                    defaultValue={ticket.request_type_id}
                    className={inputClass}
                  >
                    {maps.requestTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <CategorySelect
                  categories={maps.categories}
                  defaultCategoryId={ticket.category_id}
                  defaultSubcategoryId={ticket.subcategory_id}
                />
                <p className="text-xs text-slate-400">
                  Changing priority recalculates the SLA from the submission time.
                </p>
                <button type="submit" className={primaryButtonClass}>
                  Save triage
                </button>
              </form>
            </Panel>
          )}

          {canWork && ticket.status !== "Resolved" && (
            <Panel title="Work the ticket">
              <form action={updateTicketStatus.bind(null, ticket.id)} className="mb-5 flex gap-2">
                <select
                  name="status"
                  defaultValue={
                    WORKING_STATUSES.includes(ticket.status) ? ticket.status : "In Progress"
                  }
                  aria-label="Status"
                  className={inputClass}
                >
                  {WORKING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button type="submit" className={secondaryButtonClass}>
                  Set
                </button>
              </form>

              <form action={resolveTicket.bind(null, ticket.id)} className="space-y-3">
                <div>
                  <label htmlFor="resolutionNotes" className={labelClass}>
                    Resolution notes <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="resolutionNotes"
                    name="resolutionNotes"
                    required
                    rows={3}
                    placeholder="What was done to fix it — shown to the requester."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="rootCause" className={labelClass}>
                    Root cause
                  </label>
                  <input
                    id="rootCause"
                    name="rootCause"
                    placeholder="Optional, for reporting"
                    className={inputClass}
                  />
                </div>
                <button type="submit" className={primaryButtonClass}>
                  Mark resolved
                </button>
              </form>
            </Panel>
          )}

          {canAssign && !isClosed && (
            <Panel title="Escalation">
              {ticket.is_escalated ? (
                <form action={setEscalation.bind(null, ticket.id)}>
                  <input type="hidden" name="escalate" value="false" />
                  <button type="submit" className={secondaryButtonClass}>
                    Clear escalation
                  </button>
                </form>
              ) : (
                <form action={setEscalation.bind(null, ticket.id)} className="space-y-3">
                  <input type="hidden" name="escalate" value="true" />
                  <textarea
                    name="reason"
                    required
                    rows={2}
                    placeholder="Why does this need senior attention?"
                    aria-label="Escalation reason"
                    className={inputClass}
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Escalate
                  </button>
                </form>
              )}
            </Panel>
          )}

          {canClose && !isClosed && (
            <Panel title="Close ticket">
              {ticket.status === "Resolved" ? (
                <p className="mb-3 text-sm text-slate-500">
                  {ticket.requester_confirmed_at
                    ? `Requester confirmed on ${formatDateTime(ticket.requester_confirmed_at)}.`
                    : "Waiting for the requester to confirm — you can still close it."}
                </p>
              ) : (
                <p className="mb-3 text-sm text-amber-700">
                  This ticket isn&apos;t resolved yet. Close only duplicates or invalid requests.
                </p>
              )}
              <form action={closeTicket.bind(null, ticket.id)} className="space-y-3">
                <textarea
                  name="closureRemarks"
                  rows={2}
                  placeholder="Closure remarks (optional)"
                  aria-label="Closure remarks"
                  className={inputClass}
                />
                <button type="submit" className={primaryButtonClass}>
                  Close ticket
                </button>
              </form>
            </Panel>
          )}

          <section className={`${cardClass} p-5`}>
            <dl className="space-y-4">
              <Fact label="Requester">{nameOf(ticket.requester_person_id)}</Fact>
              {ticket.requested_for_person_id && (
                <Fact label="Requested for">{nameOf(ticket.requested_for_person_id)}</Fact>
              )}
              <Fact label="Assigned to">
                {ticket.assigned_to_person_id ? nameOf(ticket.assigned_to_person_id) : "Unassigned"}
              </Fact>
              <Fact label="Request type">
                {maps.requestTypeNameById.get(ticket.request_type_id) ?? "—"}
              </Fact>
              <Fact label="Category">
                {(ticket.category_id && maps.categoryNameById.get(ticket.category_id)) ?? "—"}
                {ticket.subcategory_id &&
                  ` / ${maps.categoryNameById.get(ticket.subcategory_id) ?? ""}`}
              </Fact>
              <Fact label="Location">
                {(ticket.site_id && orgUnits.nameById.get(ticket.site_id)) ?? "—"}
              </Fact>
              <Fact label="Department">
                {(ticket.department_id && orgUnits.nameById.get(ticket.department_id)) ?? "—"}
              </Fact>
              {ticket.asset_system_name && (
                <Fact label="Asset / system">{ticket.asset_system_name}</Fact>
              )}
              {ticket.access_required && (
                <Fact label="Access required">{ticket.access_required}</Fact>
              )}
              <Fact label="Manager approval">
                {ticket.manager_approval_required ? "Required" : "Not required"}
              </Fact>
              <Fact label="Preferred contact">{ticket.preferred_contact_method}</Fact>
              <Fact label="Response due">{formatDateTime(ticket.response_due_at)}</Fact>
              <Fact label="First response">{formatDateTime(ticket.first_responded_at)}</Fact>
              <Fact label="Resolution due">{formatDateTime(ticket.resolution_due_at)}</Fact>
              {ticket.resolved_at && (
                <Fact label="Resolved">{formatDateTime(ticket.resolved_at)}</Fact>
              )}
              {ticket.satisfaction_rating && (
                <Fact label="Requester rating">
                  {ticket.satisfaction_rating}/5
                  {ticket.satisfaction_comment && ` — “${ticket.satisfaction_comment}”`}
                </Fact>
              )}
              {ticket.closed_at && <Fact label="Closed">{formatDateTime(ticket.closed_at)}</Fact>}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
