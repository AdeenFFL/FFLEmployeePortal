import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import {
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_TONE,
  FINISHED_STATUSES,
  KIND_TONE,
  LIFECYCLE_STATUS_TONE,
  TASK_DETAIL_FIELDS,
} from "@/lib/it/onboarding";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import {
  addChecklistItem,
  addLifecycleUpdate,
  assignChecklistItem,
  cancelRequest,
  closeRequest,
  linkOnboardingPerson,
  signOffboarding,
  takeOwnership,
  updateChecklistItem,
} from "../actions";
import {
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  PriorityBadge,
  primaryButtonClass,
  secondaryButtonClass,
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

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return value ? (
    <span className="text-emerald-700">Yes</span>
  ) : (
    <span className="font-medium text-red-600">No</span>
  );
}

// ONB-02 — one onboarding / offboarding / replacement request (BRD §5.1.4–5.1.15,
// §5.2.5–5.2.16). Controls are shown by permission; the database enforces the same rules.
export default async function LifecycleRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string; q?: string }>;
}) {
  const [{ id }, { notice, error, q }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: request } = checked(
    await supabase
      .schema("it")
      .from("onboarding_offboarding")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!request) notFound();

  const [
    { data: items },
    { data: updates },
    { data: staff },
    { data: personId },
    orgUnits,
    canAssign,
    canApprove,
    canUpdate,
  ] = await Promise.all([
    supabase
      .schema("it")
      .from("checklist_items")
      .select("*")
      .eq("request_id", id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .schema("it")
      .from("onboarding_updates")
      .select("*")
      .eq("request_id", id)
      .order("created_at"),
    supabase.schema("it").rpc("list_onboarding_staff"),
    supabase.rpc("current_person_id"),
    fetchOrgUnits(supabase),
    hasItPermission(supabase, "it.onboarding.assign"),
    hasItPermission(supabase, "it.onboarding.approve"),
    hasItPermission(supabase, "it.onboarding.update"),
  ]);

  const checklist = items ?? [];
  const isFinished = FINISHED_STATUSES.includes(request.status);
  const portalTask = checklist.find((i) => i.task_type === "portal_account");
  const canLink =
    request.kind === "Onboarding" &&
    !request.person_id &&
    !isFinished &&
    (canAssign || (portalTask && portalTask.assigned_to_person_id === personId));

  const [names, { data: candidates }] = await Promise.all([
    fetchPersonNames(supabase, [
      request.person_id,
      request.requested_by,
      request.it_executive_person_id,
      request.executive_signed_by,
      request.hod_signed_by,
      ...checklist.flatMap((i) => [i.assigned_to_person_id, i.completed_by]),
      ...(updates ?? []).map((u) => u.author_person_id),
    ]),
    canLink && q
      ? supabase.schema("it").rpc("search_employees", { p_search: q })
      : Promise.resolve({ data: null }),
  ]);

  const nameOf = (pid: string | null) => (pid ? (names.get(pid) ?? "—") : "—");
  const done = checklist.filter((i) => i.status === "Completed" || i.status === "Not Applicable");

  return (
    <div className="py-6">
      <PageHeader
        title={`${request.request_number} · ${request.employee_name}`}
        description={`${request.kind} · raised by ${nameOf(request.requested_by)} on ${formatDateTime(request.created_at)}`}
        action={
          <Link href="/it/onboarding" className={secondaryButtonClass}>
            Back to list
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ---------------- Main column ---------------- */}
        <div className="space-y-6 xl:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill label={request.kind} tone={KIND_TONE[request.kind]} />
              <StatusPill label={request.status} tone={LIFECYCLE_STATUS_TONE[request.status]} />
              <PriorityBadge priority={request.priority} />
              <StatusPill label={request.routing_team} tone="neutral" />
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Employee">
                {request.employee_name}
                {request.employee_code && ` (${request.employee_code})`}
              </Fact>
              <Fact label="Designation">{request.designation ?? "—"}</Fact>
              {request.grade && <Fact label="Grade">{request.grade}</Fact>}
              <Fact label="Department">
                {(request.department_id && orgUnits.nameById.get(request.department_id)) ?? "—"}
              </Fact>
              <Fact label="Location">
                {(request.site_id && orgUnits.nameById.get(request.site_id)) ?? "—"}
              </Fact>
              <Fact label="Reporting manager">{request.reporting_manager_name ?? "—"}</Fact>
              {request.employee_category && (
                <Fact label="Category">{request.employee_category}</Fact>
              )}
              {request.joining_date && (
                <Fact label="Joining date">{formatDate(request.joining_date)}</Fact>
              )}
              {request.last_working_date && (
                <Fact label="Last working date">{formatDate(request.last_working_date)}</Fact>
              )}
              <Fact label="Due">{formatDate(request.due_date)}</Fact>
              {request.personal_email && (
                <Fact label="Personal email">{request.personal_email}</Fact>
              )}
              {request.kind === "Onboarding" && (
                <>
                  <Fact label="Email required">{request.email_required ? "Yes" : "No"}</Fact>
                  <Fact label="Laptop required">{request.laptop_required ? "Yes" : "No"}</Fact>
                </>
              )}
            </dl>
            {(request.access_required ||
              request.software_required ||
              request.known_assets_accesses ||
              request.remarks) && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
                {request.access_required && (
                  <p>
                    <span className="font-medium text-slate-600">Access required: </span>
                    {request.access_required}
                  </p>
                )}
                {request.software_required && (
                  <p>
                    <span className="font-medium text-slate-600">Software: </span>
                    {request.software_required}
                  </p>
                )}
                {request.known_assets_accesses && (
                  <p>
                    <span className="font-medium text-slate-600">Known assets / accesses: </span>
                    {request.known_assets_accesses}
                  </p>
                )}
                {request.remarks && (
                  <p>
                    <span className="font-medium text-slate-600">Remarks: </span>
                    {request.remarks}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Checklist */}
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-900">Checklist</h2>
              <span className="text-sm text-slate-500">
                {done.length}/{checklist.length} done
              </span>
            </div>

            <ul className="space-y-3">
              {checklist.map((item) => {
                const isMine = Boolean(personId) && item.assigned_to_person_id === personId;
                const canWork = !isFinished && (canAssign || (canUpdate && isMine));
                const fields = TASK_DETAIL_FIELDS[item.task_type];
                const recorded = fields.filter((f) => item.details?.[f.key]);
                return (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.task_name}</p>
                        <p className="text-xs text-slate-500">
                          {item.assigned_to_person_id
                            ? `Assigned to ${nameOf(item.assigned_to_person_id)}`
                            : "Unassigned"}
                          {item.completed_at &&
                            ` · ${item.status.toLowerCase()} by ${nameOf(item.completed_by)} on ${formatDateTime(item.completed_at)}`}
                        </p>
                      </div>
                      <StatusPill label={item.status} tone={CHECKLIST_STATUS_TONE[item.status]} />
                    </div>

                    {(recorded.length > 0 || item.notes) && (
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        {recorded.map((f) => (
                          <div key={f.key}>
                            <dt className="text-xs text-slate-400">{f.label}</dt>
                            <dd className="whitespace-pre-wrap text-slate-700">
                              {item.details[f.key]}
                            </dd>
                          </div>
                        ))}
                        {item.notes && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs text-slate-400">Notes</dt>
                            <dd className="whitespace-pre-wrap text-slate-700">{item.notes}</dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {item.task_type === "portal_account" && request.person_id && (
                      <p className="mt-2 text-xs text-emerald-700">
                        Linked portal account: {nameOf(request.person_id)}
                      </p>
                    )}

                    {item.task_type === "portal_account" && canLink && (
                      <div className="mt-3 rounded-lg bg-slate-50 p-3">
                        <p className="mb-2 text-xs text-slate-600">
                          Create the account on User Management first, then link it here so the
                          new joiner can confirm their onboarding.
                        </p>
                        <form method="get" className="mb-2 flex gap-2">
                          <input
                            name="q"
                            defaultValue={q ?? ""}
                            placeholder="Search name or employee code"
                            aria-label="Search employees"
                            className={inputClass}
                          />
                          <button type="submit" className={secondaryButtonClass}>
                            Search
                          </button>
                        </form>
                        {q && (
                          <form action={linkOnboardingPerson.bind(null, request.id)} className="space-y-2">
                            {(candidates ?? []).length === 0 ? (
                              <p className="text-xs text-slate-400">No match for “{q}”.</p>
                            ) : (
                              (candidates ?? []).map((c) => (
                                <label key={c.person_id} className="flex items-center gap-2 text-sm">
                                  <input type="radio" name="personId" value={c.person_id} required />
                                  {c.full_name}
                                  <span className="text-xs text-slate-400">
                                    {[c.employee_code, c.designation].filter(Boolean).join(" · ")}
                                  </span>
                                </label>
                              ))
                            )}
                            {(candidates ?? []).length > 0 && (
                              <button type="submit" className={primaryButtonClass}>
                                Link employee
                              </button>
                            )}
                          </form>
                        )}
                      </div>
                    )}

                    {canAssign && !isFinished && (
                      <form
                        action={assignChecklistItem.bind(null, request.id, item.id)}
                        className="mt-3 flex gap-2"
                      >
                        <select
                          name="assigneeId"
                          defaultValue={item.assigned_to_person_id ?? ""}
                          aria-label={`Assignee for ${item.task_name}`}
                          className={inputClass}
                        >
                          <option value="">Unassigned</option>
                          {(staff ?? []).map((s) => (
                            <option key={s.person_id} value={s.person_id}>
                              {s.full_name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className={secondaryButtonClass}>
                          Assign
                        </button>
                      </form>
                    )}

                    {canWork && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-blue-700">
                          Update task
                        </summary>
                        <form
                          action={updateChecklistItem.bind(null, request.id, item.id)}
                          className="mt-3 space-y-3"
                        >
                          {fields.map((f) => (
                            <label key={f.key} className="block">
                              <span className={labelClass}>{f.label}</span>
                              {f.multiline ? (
                                <textarea
                                  name={`detail_${f.key}`}
                                  rows={2}
                                  defaultValue={item.details?.[f.key] ?? ""}
                                  placeholder={f.placeholder}
                                  className={inputClass}
                                />
                              ) : (
                                <input
                                  name={`detail_${f.key}`}
                                  defaultValue={item.details?.[f.key] ?? ""}
                                  placeholder={f.placeholder}
                                  className={inputClass}
                                />
                              )}
                            </label>
                          ))}
                          <label className="block">
                            <span className={labelClass}>Notes</span>
                            <textarea
                              name="notes"
                              rows={2}
                              defaultValue={item.notes ?? ""}
                              placeholder="Required if marking Not Applicable"
                              className={inputClass}
                            />
                          </label>
                          <div className="flex gap-2">
                            <select
                              name="status"
                              defaultValue={item.status}
                              aria-label="Task status"
                              className={inputClass}
                            >
                              {CHECKLIST_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className={primaryButtonClass}>
                              Save
                            </button>
                          </div>
                        </form>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>

            {canAssign && !isFinished && (
              <form
                action={addChecklistItem.bind(null, request.id)}
                className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3"
              >
                <input
                  name="taskName"
                  required
                  placeholder="Extra task, e.g. Issue SIM card"
                  aria-label="Task name"
                  className={`${inputClass} md:col-span-2`}
                />
                <select name="assigneeId" defaultValue="" aria-label="Assignee" className={inputClass}>
                  <option value="">Unassigned</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.person_id} value={s.person_id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
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
            {request.status !== "Closed" && request.status !== "Cancelled" && (
              <form
                action={addLifecycleUpdate.bind(null, request.id)}
                className="mt-4 space-y-3 border-t border-slate-100 pt-4"
              >
                <textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Add a comment…"
                  aria-label="Comment"
                  className={inputClass}
                />
                <div className="flex flex-wrap items-center gap-4">
                  {(canAssign || canUpdate || canApprove) && (
                    <>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="radio" name="visibility" value="public" defaultChecked />
                        Visible to HR / employee
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="radio" name="visibility" value="internal" />
                        Internal note (IT only)
                      </label>
                    </>
                  )}
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
          <Panel title="IT Executive">
            <p className="mb-3 text-sm text-slate-700">
              {request.it_executive_person_id
                ? nameOf(request.it_executive_person_id)
                : "Not picked up yet"}
            </p>
            {canAssign &&
              !isFinished &&
              request.it_executive_person_id !== personId && (
                <form action={takeOwnership.bind(null, request.id)}>
                  <button type="submit" className={primaryButtonClass}>
                    {request.it_executive_person_id ? "Take over" : "Pick up request"}
                  </button>
                </form>
              )}
          </Panel>

          {request.kind === "Onboarding" && (
            <Panel title="Employee confirmation">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Portal account linked</dt>
                  <dd>{request.person_id ? nameOf(request.person_id) : "—"}</dd>
                </div>
                {request.email_required && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Email working</dt>
                    <dd><YesNo value={request.email_confirmed} /></dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-500">Access received</dt>
                  <dd><YesNo value={request.access_confirmed} /></dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Software available</dt>
                  <dd><YesNo value={request.software_confirmed} /></dd>
                </div>
                {request.laptop_required && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Asset received</dt>
                    <dd><YesNo value={request.asset_confirmed} /></dd>
                  </div>
                )}
              </dl>
              {request.confirmation_notes && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  {request.confirmation_notes}
                </p>
              )}
              {request.employee_confirmed_at && (
                <p className="mt-3 text-xs text-slate-400">
                  Confirmed {formatDateTime(request.employee_confirmed_at)}
                </p>
              )}
              {request.status === "Awaiting Confirmation" && !request.employee_confirmed_at && (
                <p className="mt-3 text-xs text-slate-500">
                  Waiting for the employee to confirm on My Onboarding.
                </p>
              )}
            </Panel>
          )}

          {request.kind === "Offboarding" && (
            <Panel title="Handover-takeover sign-off">
              <dl className="mb-3 space-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">IT Executive</dt>
                  <dd>
                    {request.executive_signed_at
                      ? `${nameOf(request.executive_signed_by)} · ${formatDateTime(request.executive_signed_at)}`
                      : "Not signed"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">HOD IT</dt>
                  <dd>
                    {request.hod_signed_at
                      ? `${nameOf(request.hod_signed_by)} · ${formatDateTime(request.hod_signed_at)}`
                      : "Not signed"}
                  </dd>
                </div>
              </dl>
              {request.status !== "Pending Final Review" && !request.hod_signed_at && (
                <p className="text-xs text-slate-500">
                  Sign-off opens once every checklist item is completed or marked not applicable.
                </p>
              )}
              {request.status === "Pending Final Review" && (
                <div className="flex flex-wrap gap-2">
                  {canAssign && !request.executive_signed_at && (
                    <form action={signOffboarding.bind(null, request.id, "executive")}>
                      <button type="submit" className={primaryButtonClass}>
                        Sign as IT Executive
                      </button>
                    </form>
                  )}
                  {canApprove && request.executive_signed_at && (
                    <form action={signOffboarding.bind(null, request.id, "hod")}>
                      <button type="submit" className={primaryButtonClass}>
                        Approve as HOD IT
                      </button>
                    </form>
                  )}
                  {canApprove && !request.executive_signed_at && (
                    <p className="text-xs text-slate-500">Waiting for the IT Executive to sign.</p>
                  )}
                </div>
              )}
            </Panel>
          )}

          {request.status === "Completed" &&
            (request.kind === "Offboarding" ? canApprove : canAssign) && (
              <Panel title="Close request">
                <p className="mb-3 text-sm text-slate-500">
                  Everything is done. Closing keeps the full history for audits.
                </p>
                <form action={closeRequest.bind(null, request.id)}>
                  <button type="submit" className={primaryButtonClass}>
                    Close request
                  </button>
                </form>
              </Panel>
            )}

          {canAssign && ["Open", "Under Review", "In Progress"].includes(request.status) && (
            <Panel title="Cancel request">
              <form action={cancelRequest.bind(null, request.id)} className="space-y-3">
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder="Why is this request being cancelled?"
                  aria-label="Cancellation reason"
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Cancel request
                </button>
              </form>
            </Panel>
          )}

          {request.status === "Cancelled" && request.cancelled_reason && (
            <Panel title="Cancelled">
              <p className="text-sm text-slate-700">{request.cancelled_reason}</p>
            </Panel>
          )}

          <p className="px-1 text-xs text-slate-400">
            Passwords are never stored in the portal. Share temporary credentials with the
            employee directly.
          </p>
        </div>
      </div>
    </div>
  );
}
