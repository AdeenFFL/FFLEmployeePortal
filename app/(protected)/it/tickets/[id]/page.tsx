import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  canManageSite,
  checked,
  fetchTicketScope,
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
  transferToHq,
  addHelper,
  removeHelper,
  triageTicket,
  updateTaskStatus,
  updateTicketStatus,
} from "../actions";
import { CategorySelect } from "../../_components/category-select";
import { Modal } from "@/components/modal";
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

function Panel({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={`${cardClass} scroll-mt-6 p-5`}>
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
  searchParams: Promise<{
    notice?: string;
    error?: string;
    assetQ?: string;
    device?: string;
    triage?: string;
    helpers?: string;
    transfer?: string;
    work?: string;
    escalate?: string;
    close?: string;
  }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { notice, error, assetQ } = sp;
  const supabase = await createClient();
  const basePath = `/it/tickets/${id}`;

  const { data: ticket } = checked(
    await supabase.schema("it").from("tickets").select("*").eq("id", id).maybeSingle(),
  );
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
    canClose,
    scope,
  ] = await Promise.all([
    supabase.schema("it").from("ticket_updates").select("*").eq("ticket_id", id).order("created_at"),
    supabase.schema("it").from("ticket_tasks").select("*").eq("ticket_id", id).order("created_at"),
    supabase
      .schema("it")
      .from("ticket_attachments")
      .select("id, storage_path, file_name, size_bytes")
      .eq("ticket_id", id)
      .order("created_at"),
    // Only people this viewer may assign: HQ -> any IT staff; site manager -> the site's team.
    supabase.schema("it").rpc("list_ticket_assignees", { p_ticket_id: id }),
    supabase.rpc("current_person_id"),
    fetchCategoryMaps(supabase),
    fetchOrgUnits(supabase),
    hasItPermission(supabase, "it.tickets.update"),
    hasItPermission(supabase, "it.tickets.close"),
    fetchTicketScope(supabase),
  ]);

  // Triage rights follow the handling site (javaria_it_0005): its IT manager(s), or HQ.
  const canAssign = canManageSite(scope, ticket.handling_site_id);
  const handlingSiteName =
    (ticket.handling_site_id && orgUnits.nameById.get(ticket.handling_site_id)) ?? "HQ / unrouted";
  const canTransferToHq =
    canAssign &&
    !scope.hqExecutive &&
    Boolean(scope.hqSiteId) &&
    ticket.handling_site_id !== scope.hqSiteId &&
    !["Resolved", "Closed"].includes(ticket.status);

  const isClosed = ticket.status === "Closed";
  const isAssignee = Boolean(personId) && ticket.assigned_to_person_id === personId;
  const canWork = !isClosed && canUpdate && (isAssignee || canAssign);
  const canComment = !isClosed && (canUpdate || canAssign);
  // Same rule as the tickets update policy: executives, or the assignee with it.tickets.update.
  const canSetDevice = !isClosed && (canAssign || (canUpdate && isAssignee));

  // Phase 6.2–6.4 data: helpers, task assignees, category owners ("Routed to"), closure record.
  const taskIds = (tasks ?? []).map((t) => t.id);
  const [{ data: assignees }, { data: taskAssignees }, { data: owners }, { data: closure }] =
    await Promise.all([
      supabase.schema("it").from("ticket_assignees").select("person_id, role").eq("ticket_id", id),
      taskIds.length
        ? supabase.schema("it").from("ticket_task_assignees").select("task_id, person_id").in("task_id", taskIds)
        : Promise.resolve({ data: [] as { task_id: string; person_id: string }[] }),
      supabase.schema("it").rpc("list_category_owners"),
      scope.readAll && ticket.status === "Closed"
        ? supabase
            .schema("it")
            .from("ticket_closure_audit")
            .select("closed_at, closed_by, sla_met")
            .eq("ticket_id", id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  const helpers = (assignees ?? []).filter((a) => a.role === "helper");
  const isHelper = Boolean(personId) && helpers.some((h) => h.person_id === personId);
  const extrasByTask = new Map<string, string[]>();
  for (const ta of taskAssignees ?? []) {
    extrasByTask.set(ta.task_id, [...(extrasByTask.get(ta.task_id) ?? []), ta.person_id]);
  }
  // Same precedence as auto-assignment: subcategory owners at the handling site, else category's.
  const siteOwners = (owners ?? []).filter((o) => o.site_id === ticket.handling_site_id);
  const subOwners = siteOwners.filter((o) => o.category_id === ticket.subcategory_id);
  const routedOwners = subOwners.length
    ? subOwners
    : siteOwners.filter((o) => o.category_id === ticket.category_id);
  const routedScope = subOwners.length ? ticket.subcategory_id : ticket.category_id;

  const [names, urls, assetLabels, { data: assetMatches }] = await Promise.all([
    fetchPersonNames(supabase, [
      ticket.requester_person_id,
      ticket.requested_for_person_id,
      ticket.assigned_to_person_id,
      ticket.escalated_by,
      closure?.closed_by,
      ...(updates ?? []).map((u) => u.author_person_id),
      ...(tasks ?? []).map((t) => t.assigned_to_person_id),
      ...helpers.map((h) => h.person_id),
      ...(taskAssignees ?? []).map((ta) => ta.person_id),
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
                    (canAssign ||
                      (canUpdate &&
                        (task.assigned_to_person_id === personId ||
                          (extrasByTask.get(task.id) ?? []).includes(personId ?? ""))));
                  const extras = extrasByTask.get(task.id) ?? [];
                  return (
                    <li key={task.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{task.task_type}</p>
                        {task.description && (
                          <p className="text-sm text-slate-500">{task.description}</p>
                        )}
                        <p className="text-xs text-slate-400">
                          {nameOf(task.assigned_to_person_id)}
                          {extras.length > 0 && ` + ${extras.map((pid) => nameOf(pid)).join(", ")}`}
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
                {(staff ?? []).length > 1 && (
                  <fieldset className="md:col-span-3">
                    <legend className="mb-1 text-xs font-medium text-slate-500">
                      Also assign to (optional)
                    </legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {(staff ?? []).map((s) => (
                        <label key={s.person_id} className="flex items-center gap-1.5 text-sm text-slate-700">
                          <input type="checkbox" name="extraAssigneeIds" value={s.person_id} />
                          {s.full_name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
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
                <Link href={`${basePath}?device=1`} className={secondaryButtonClass}>
                  {ticket.linked_asset_id ? "Change device" : "Link a device"}
                </Link>
              )}
            </Panel>
          )}
          {canSetDevice && sp.device === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Link a device">
              <form method="get" className="flex gap-2">
                <input type="hidden" name="device" value="1" />
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
            </Modal>
          )}

          {canAssign && !isClosed && (
            <Panel title="Triage" id="triage">
              <p className="mb-3 text-sm text-slate-500">
                Assigned to {ticket.assigned_to_person_id ? nameOf(ticket.assigned_to_person_id) : "nobody yet"}.
              </p>
              <Link href={`${basePath}?triage=1`} className={primaryButtonClass}>
                Triage
              </Link>
            </Panel>
          )}
          {canAssign && !isClosed && sp.triage === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Triage">
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
                        {s.is_category_owner ? "★ " : ""}
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
                {scope.hqExecutive && (
                  <div>
                    <label htmlFor="handlingSiteId" className={labelClass}>
                      Handled at
                    </label>
                    <select
                      id="handlingSiteId"
                      name="handlingSiteId"
                      defaultValue={ticket.handling_site_id ?? ""}
                      className={inputClass}
                    >
                      {!ticket.handling_site_id && <option value="">HQ / unrouted</option>}
                      {orgUnits.sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  Changing priority recalculates the SLA from the submission time. Changing the
                  request type or category may re-route the ticket (e.g. to HQ); moving it to
                  another site clears the assignee.
                </p>
                <button type="submit" className={primaryButtonClass}>
                  Save triage
                </button>
              </form>
            </Modal>
          )}

          {(helpers.length > 0 || (canAssign && !isClosed)) && (
            <Panel title="Helpers">
              {isHelper && (
                <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  You&apos;re a helper: you can comment, add internal notes and tasks. The primary
                  assignee changes the status and resolves.
                </p>
              )}
              {helpers.length === 0 ? (
                <p className="mb-3 text-sm text-slate-400">No helpers.</p>
              ) : (
                <ul className="mb-3 space-y-1">
                  {helpers.map((h) => (
                    <li key={h.person_id} className="flex items-center justify-between text-sm text-slate-800">
                      {nameOf(h.person_id)}
                      {canAssign && !isClosed && (
                        <form action={removeHelper.bind(null, ticket.id, h.person_id)}>
                          <button type="submit" className="text-xs text-slate-500 hover:text-red-600">
                            Remove
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canAssign && !isClosed && (
                <Link href={`${basePath}?helpers=1`} className={secondaryButtonClass}>
                  Add a helper
                </Link>
              )}
            </Panel>
          )}
          {canAssign && !isClosed && sp.helpers === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Add a helper">
              <form action={addHelper.bind(null, ticket.id)} className="flex gap-2">
                <select name="helperId" defaultValue="" required aria-label="Add helper" className={inputClass}>
                  <option value="" disabled>
                    Add a helper…
                  </option>
                  {(staff ?? [])
                    .filter(
                      (s) =>
                        s.person_id !== ticket.assigned_to_person_id &&
                        !helpers.some((h) => h.person_id === s.person_id),
                    )
                    .map((s) => (
                      <option key={s.person_id} value={s.person_id}>
                        {s.is_category_owner ? "★ " : ""}
                        {s.full_name}
                      </option>
                    ))}
                </select>
                <button type="submit" className={secondaryButtonClass}>
                  Add
                </button>
              </form>
            </Modal>
          )}

          {canTransferToHq && (
            <Panel title="Transfer to HQ">
              <p className="mb-3 text-sm text-slate-500">
                For work only HQ can do (e.g. SAP / ERP access, email accounts).
              </p>
              <Link href={`${basePath}?transfer=1`} className={secondaryButtonClass}>
                Transfer to HQ
              </Link>
            </Panel>
          )}
          {canTransferToHq && sp.transfer === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Transfer to HQ">
              <form action={transferToHq.bind(null, ticket.id)} className="space-y-3">
                <p className="text-sm text-slate-500">
                  The ticket leaves {handlingSiteName}&apos;s queue and goes unassigned to HQ.
                </p>
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder="Why does HQ need to handle this?"
                  aria-label="Reason for transfer"
                  className={inputClass}
                />
                <button type="submit" className={secondaryButtonClass}>
                  Transfer to HQ
                </button>
              </form>
            </Modal>
          )}

          {canWork && ticket.status !== "Resolved" && (
            <Panel title="Work the ticket">
              <p className="mb-3 text-sm text-slate-500">Current status: {ticket.status}.</p>
              <Link href={`${basePath}?work=1`} className={primaryButtonClass}>
                Update / resolve
              </Link>
            </Panel>
          )}
          {canWork && ticket.status !== "Resolved" && sp.work === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Work the ticket">
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
            </Modal>
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
                <Link
                  href={`${basePath}?escalate=1`}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Escalate
                </Link>
              )}
            </Panel>
          )}
          {canAssign && !isClosed && !ticket.is_escalated && sp.escalate === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Escalate">
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
            </Modal>
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
              <Link href={`${basePath}?close=1`} className={primaryButtonClass}>
                Close ticket
              </Link>
            </Panel>
          )}
          {canClose && !isClosed && sp.close === "1" && (
            <Modal key={Date.now()} closeHref={basePath} title="Close ticket">
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
            </Modal>
          )}

          <section className={`${cardClass} p-5`}>
            <dl className="space-y-4">
              <Fact label="Handled at">{handlingSiteName}</Fact>
              <Fact label="Routed to">
                {routedScope && routedOwners.length > 0
                  ? `${maps.categoryNameById.get(routedScope) ?? "Category"} owners: ${routedOwners
                      .map((o) => `${o.is_primary ? "★ " : ""}${o.full_name}`)
                      .join(", ")}`
                  : "No category owner here — site manager assigns"}
              </Fact>
              {closure && (
                <Fact label="Closure record">
                  Captured {formatDateTime(closure.closed_at)}
                  {closure.closed_by && ` by ${nameOf(closure.closed_by)}`} · SLA{" "}
                  {closure.sla_met === null ? "n/a" : closure.sla_met ? "met" : "missed"}
                </Fact>
              )}
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
