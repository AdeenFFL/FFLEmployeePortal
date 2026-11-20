import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Modal } from "@/components/modal";
import { AssetAllocationForm } from "../../../_components/asset-allocation-form";
import { AssetReturnForm } from "../../../../inventory/_components/asset-return-form";
import { listOpenAssignments } from "@/lib/it/assets";
import { fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import {
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_TONE,
  FINISHED_STATUSES,
  KIND_TONE,
  suggestEmailAccount,
  TASK_DETAIL_FIELDS,
  taskGuide,
} from "@/lib/it/onboarding";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import type { ItChecklistTaskType, ItLifecycleRequest } from "@/types/database";
import {
  addLifecycleUpdate,
  assignChecklistItem,
  completeEmailAccountTask,
  completeHandoverTask,
  completePortalAccountTask,
  linkOnboardingPerson,
  updateChecklistItem,
} from "../../../actions";
import {
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../../../_components/ticket-ui";

// What the person working a task needs to know about the employee, and nothing else.
type FactKey =
  | "designation"
  | "department"
  | "personalEmail"
  | "companyEmail"
  | "software"
  | "access"
  | "knownAssets"
  | "laptop"
  | "account";

const TASK_FACTS: Record<ItChecklistTaskType, FactKey[]> = {
  email_account: ["designation", "department", "personalEmail"],
  license_assignment: ["designation", "department", "companyEmail", "software"],
  access_provisioning: ["designation", "department", "companyEmail", "access"],
  software_installation: ["designation", "software", "laptop"],
  asset_allocation: ["designation", "laptop", "account"],
  asset_handover: ["laptop", "account"],
  portal_account: ["designation", "department", "personalEmail", "companyEmail", "account"],
  email_backup_closure: ["designation", "department", "knownAssets"],
  access_revocation: ["department", "access", "knownAssets"],
  hardware_recovery: ["designation", "knownAssets"],
  asset_return: ["designation", "knownAssets"],
  license_deactivation: ["department", "software", "knownAssets"],
  other: ["designation", "department", "personalEmail", "companyEmail", "access", "software", "knownAssets"],
};

// One checklist task on its own screen (My Tasks → a task). Only the person it's assigned to and
// whoever runs the request (it.onboarding.assign, or its IT Executive) can open it; it shows the
// employee facts that task needs and the one form that completes it.
export default async function ChecklistTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string }>;
  searchParams: Promise<{ notice?: string; error?: string; q?: string; returnAsset?: string }>;
}) {
  const [{ id, taskId }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const taskPath = `/it/onboarding/${id}/tasks/${taskId}`;

  const [{ data: request }, { data: item }, { data: personId }] = await Promise.all([
    supabase.schema("it").from("onboarding_offboarding").select("*").eq("id", id).maybeSingle(),
    supabase
      .schema("it")
      .from("checklist_items")
      .select("*")
      .eq("id", taskId)
      .eq("request_id", id)
      .maybeSingle(),
    supabase.rpc("current_person_id"),
  ]);
  if (!request || !item) notFound();

  const [canAssign, canUpdate, canAssignAssets] = await Promise.all([
    hasItPermission(supabase, "it.onboarding.assign"),
    hasItPermission(supabase, "it.onboarding.update"),
    hasItPermission(supabase, "it.assets.assign"),
  ]);
  const isMine = Boolean(personId) && item.assigned_to_person_id === personId;
  const isManager = canAssign || (Boolean(personId) && request.it_executive_person_id === personId);

  if (!isMine && !isManager) {
    return (
      <div className="py-6">
        <PageHeader
          title={item.task_name}
          description={`${request.kind} ${request.request_number}`}
          action={
            <Link href="/it/my-work" className={secondaryButtonClass}>
              My Tasks
            </Link>
          }
        />
        <section className={`${cardClass} p-6 text-sm text-slate-600`}>
          This task is assigned to someone else. Your own tasks are on My Tasks.
        </section>
      </div>
    );
  }

  const isFinished = FINISHED_STATUSES.includes(request.status);
  const isOpen = item.status === "Pending" || item.status === "In Progress";
  const canWork = !isFinished && (canAssign || (canUpdate && isMine));

  const [{ data: siblings }, orgUnits, { data: staff }] = await Promise.all([
    supabase
      .schema("it")
      .from("checklist_items")
      .select("task_type, assignment_id, details, status")
      .eq("request_id", id)
      .in("task_type", ["email_account", "asset_allocation"]),
    fetchOrgUnits(supabase),
    isManager && !isFinished ? supabase.schema("it").rpc("list_onboarding_staff") : Promise.resolve({ data: null }),
  ]);
  const companyEmail =
    (siblings ?? []).find((s) => s.task_type === "email_account")?.details?.email_address ?? null;
  const allocationAssignmentId =
    (siblings ?? []).find((s) => s.task_type === "asset_allocation")?.assignment_id ?? null;

  // Task-specific data, read only for the task that needs it.
  const admin = createAdminClient();
  const ownAssignmentId = item.task_type === "asset_allocation" ? item.assignment_id : null;
  const handoverAssignmentId = item.task_type === "asset_handover" ? allocationAssignmentId : null;
  const assignmentToRead = ownAssignmentId ?? handoverAssignmentId;
  const [{ data: assignment }, { data: roles }, { data: candidates }, leaverAssets] = await Promise.all([
    // asset_assignments needs it.assets.read or being the holder; the task's own assignee may hold
    // neither, so this one read uses the admin client (same as completeHandoverTask).
    assignmentToRead
      ? admin
          .schema("it")
          .from("asset_assignments")
          .select("acknowledged_at, assets(asset_tag, asset_name)")
          .eq("id", assignmentToRead)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    item.task_type === "portal_account" && canAssign && isOpen && !isFinished
      ? supabase.from("roles").select("id, name").order("name")
      : Promise.resolve({ data: null }),
    item.task_type === "portal_account" && !request.person_id && sp.q && !isFinished
      ? supabase.schema("it").rpc("search_employees", { p_search: sp.q })
      : Promise.resolve({ data: null }),
    (item.task_type === "asset_return" || item.task_type === "hardware_recovery") &&
    request.kind === "Offboarding" &&
    request.person_id &&
    canAssignAssets
      ? listOpenAssignments(supabase, request.person_id)
      : Promise.resolve([]),
  ]);
  const asset = assignment?.assets as unknown as { asset_tag: string; asset_name: string } | null;
  const returning = leaverAssets.find((a) => a.id === sp.returnAsset);

  const names = await fetchPersonNames(supabase, [
    request.person_id,
    request.it_executive_person_id,
    item.assigned_to_person_id,
    item.completed_by,
  ]);
  const nameOf = (pid: string | null) => (pid ? (names.get(pid) ?? "—") : "—");

  const fields = TASK_DETAIL_FIELDS[item.task_type] ?? [];
  const recorded = fields.filter((f) => item.details?.[f.key]);
  const suggestion = item.task_type === "email_account" ? suggestEmailAccount(request.employee_name) : null;
  const taskPageField = <input type="hidden" name="taskPage" value={item.id} />;

  return (
    <div className="py-6">
      <PageHeader
        title={item.task_name}
        description={`${request.kind} ${request.request_number} · ${request.employee_name}`}
        action={
          <div className="flex gap-2">
            {isManager && (
              <Link href={`/it/onboarding/${id}`} className={secondaryButtonClass}>
                Whole request
              </Link>
            )}
            <Link href="/it/my-work" className={secondaryButtonClass}>
              My Tasks
            </Link>
          </div>
        }
      />
      <FormMessage error={sp.error} notice={sp.notice} />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ---------------- The task ---------------- */}
        <div className="space-y-6 xl:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm text-slate-500">
                <p>
                  {item.assigned_to_person_id
                    ? isMine
                      ? "Assigned to you"
                      : `Assigned to ${nameOf(item.assigned_to_person_id)}`
                    : "Unassigned"}
                  {item.due_date && ` · due ${formatDate(item.due_date)}`}
                </p>
                {item.completed_at && (
                  <p>
                    {item.status} by {nameOf(item.completed_by)} on {formatDateTime(item.completed_at)}
                  </p>
                )}
              </div>
              <StatusPill label={item.status} tone={CHECKLIST_STATUS_TONE[item.status]} />
            </div>

            {isFinished && (
              <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                This request is {request.status.toLowerCase()}; nothing more to do here.
              </p>
            )}

            {isOpen && !isFinished && (
              <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <span className="font-semibold">How to complete: </span>
                {taskGuide(item.task_type, request.kind, request.email_required)}
              </p>
            )}

            {(recorded.length > 0 || item.notes) && (
              <dl className="mb-4 grid gap-3 sm:grid-cols-2">
                {recorded.map((f) => (
                  <Fact key={f.key} label={f.label}>
                    <span className="whitespace-pre-wrap">{item.details[f.key]}</span>
                  </Fact>
                ))}
                {item.notes && (
                  <div className="sm:col-span-2">
                    <Fact label="Notes">
                      <span className="whitespace-pre-wrap">{item.notes}</span>
                    </Fact>
                  </div>
                )}
              </dl>
            )}

            {/* ----- The form that completes this task ----- */}
            {item.task_type === "asset_allocation" ? (
              asset ? (
                <p className="text-sm text-emerald-700">
                  Assigned: {asset.asset_tag} — {asset.asset_name}
                </p>
              ) : !isOpen || isFinished ? null : !request.person_id ? (
                <p className="text-sm text-amber-700">
                  Waiting: the employee&apos;s portal account isn&apos;t linked to this request yet. It links
                  itself when they first sign in (or under Employee Portal Account Creation).
                </p>
              ) : !canAssignAssets ? (
                <p className="text-sm text-amber-700">
                  Assigning an asset needs the Asset Register&apos;s assign right. Ask the IT Executive (
                  {nameOf(request.it_executive_person_id)}) to give it to you or do this step.
                </p>
              ) : (
                <div className="rounded-lg border border-slate-200 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Assign an asset to {request.employee_name}</h3>
                  <AssetAllocationForm requestId={request.id} itemId={item.id} fromTaskPage />
                </div>
              )
            ) : item.task_type === "asset_handover" ? (
              <div className="space-y-3 text-sm">
                <p className="text-slate-600">
                  {!allocationAssignmentId
                    ? "No asset assigned yet (Asset Allocation task)."
                    : assignment?.acknowledged_at
                      ? `${asset?.asset_tag ?? "The asset"} acknowledged by the employee on ${formatDateTime(assignment.acknowledged_at)}.`
                      : `Waiting for the employee to acknowledge ${asset?.asset_tag ?? "the asset"} on My Assets.`}
                </p>
                {canWork && isOpen && assignment?.acknowledged_at && (
                  <form action={completeHandoverTask.bind(null, request.id, item.id)}>
                    {taskPageField}
                    <button type="submit" className={primaryButtonClass}>
                      Mark handover confirmed
                    </button>
                  </form>
                )}
              </div>
            ) : item.task_type === "portal_account" ? (
              <div className="space-y-4 text-sm">
                <p className="text-slate-600">
                  {request.person_id
                    ? `Portal account linked: ${nameOf(request.person_id)}.`
                    : request.email_required
                      ? companyEmail
                        ? `Sign-in invite goes to ${companyEmail}; the account is made the first time they sign in.`
                        : "The Email Account task isn't done yet, so there is no invite to set a role on."
                      : `Account on ${request.personal_email ?? "their personal email"}.`}
                </p>
                {isOpen && !isFinished && canAssign && (
                  <form
                    action={completePortalAccountTask.bind(null, request.id, item.id)}
                    className="space-y-3 rounded-lg border border-slate-200 p-4"
                  >
                    {taskPageField}
                    <label className="block">
                      <span className={labelClass}>Role *</span>
                      <select
                        name="roleId"
                        required
                        defaultValue={(roles ?? []).find((r) => r.name === "Employee")?.id ?? ""}
                        className={inputClass}
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {(roles ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className={primaryButtonClass}>
                      Create portal account
                    </button>
                  </form>
                )}
                {isOpen && !isFinished && !canAssign && (
                  <p className="text-amber-700">
                    Choosing the role needs onboarding-assign rights. The IT Executive (
                    {nameOf(request.it_executive_person_id)}) does this step.
                  </p>
                )}
                {!request.person_id && !request.email_required && !isFinished && (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="mb-2 text-xs text-slate-600">Link their portal account to this request:</p>
                    <form method="get" className="mb-2 flex gap-2">
                      <input
                        name="q"
                        defaultValue={sp.q ?? ""}
                        placeholder="Search name or employee code"
                        aria-label="Search employees"
                        className={inputClass}
                      />
                      <button type="submit" className={secondaryButtonClass}>
                        Search
                      </button>
                    </form>
                    {sp.q && (
                      <form action={linkOnboardingPerson.bind(null, request.id)} className="space-y-2">
                        {taskPageField}
                        {(candidates ?? []).length === 0 ? (
                          <p className="text-xs text-slate-400">No match for “{sp.q}”.</p>
                        ) : (
                          <>
                            {(candidates ?? []).map((c) => (
                              <label key={c.person_id} className="flex items-center gap-2">
                                <input type="radio" name="personId" value={c.person_id} required />
                                {c.full_name}
                                <span className="text-xs text-slate-400">
                                  {[c.employee_code, c.designation].filter(Boolean).join(" · ")}
                                </span>
                              </label>
                            ))}
                            <button type="submit" className={primaryButtonClass}>
                              Link employee
                            </button>
                          </>
                        )}
                      </form>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {leaverAssets.length > 0 && !isFinished && (
                  <div className="mb-4 rounded-lg border border-slate-200 p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">Still held by {request.employee_name}</h3>
                    <ul className="divide-y divide-slate-100 text-sm">
                      {leaverAssets.map((a) => {
                        const held = a.assets as unknown as { asset_tag: string; asset_name: string } | null;
                        return (
                          <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                            <span>
                              <span className="font-mono text-xs text-slate-500">{held?.asset_tag}</span>{" "}
                              {held?.asset_name}
                            </span>
                            <Link
                              href={`${taskPath}?returnAsset=${a.id}`}
                              className="shrink-0 font-medium text-blue-700 hover:underline"
                            >
                              Record return
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {canWork ? (
                  <form
                    action={
                      item.task_type === "email_account"
                        ? completeEmailAccountTask.bind(null, request.id, item.id)
                        : updateChecklistItem.bind(null, request.id, item.id)
                    }
                    className="space-y-3 rounded-lg border border-slate-200 p-4"
                  >
                    {taskPageField}
                    {fields.map((f) => {
                      const fallback =
                        suggestion && (f.key === "email_address" || f.key === "username")
                          ? suggestion[f.key]
                          : "";
                      return (
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
                              defaultValue={item.details?.[f.key] ?? fallback}
                              placeholder={f.placeholder}
                              className={inputClass}
                            />
                          )}
                        </label>
                      );
                    })}
                    {suggestion && !item.details?.email_address && (
                      <p className="text-xs text-slate-500">
                        Suggested from the name. Change it if the mailbox you created is different.
                      </p>
                    )}
                    {item.task_type !== "email_account" && (
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
                    )}
                    <div className="flex gap-2">
                      <select name="status" defaultValue={item.status} aria-label="Task status" className={inputClass}>
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
                ) : (
                  !isFinished &&
                  isOpen && (
                    <p className="text-sm text-amber-700">You can&apos;t update this task.</p>
                  )
                )}
              </>
            )}
          </section>

          {canAssignAssets && returning && !isFinished && (
            <Modal key={returning.id} closeHref={taskPath} title="Return asset">
              <AssetReturnForm
                assetId={returning.asset_id}
                assignedDate={returning.assigned_date}
                assignedCondition={returning.assigned_condition}
                holderName={request.employee_name}
                returnTo={taskPath}
              />
            </Modal>
          )}

          {/* A note about this task, for the IT Executive (IT only). */}
          {!isFinished && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-sm font-semibold text-slate-900">Note to the IT Executive</h2>
              <p className="mb-3 text-xs text-slate-500">
                Blocked or need something? It goes on the request&apos;s activity as an internal note (IT only).
              </p>
              <form action={addLifecycleUpdate.bind(null, request.id)} className="space-y-3">
                {taskPageField}
                <input type="hidden" name="taskName" value={item.task_name} />
                <input type="hidden" name="visibility" value="internal" />
                <textarea name="body" required rows={2} aria-label="Note" className={inputClass} />
                <button type="submit" className={secondaryButtonClass}>
                  Add note
                </button>
              </form>
            </section>
          )}
        </div>

        {/* ---------------- What this task needs to know ---------------- */}
        <div className="space-y-6">
          <EmployeeFacts
            request={request}
            keys={TASK_FACTS[item.task_type] ?? []}
            nameById={orgUnits.nameById}
            companyEmail={companyEmail}
            accountName={request.person_id ? nameOf(request.person_id) : null}
            executiveName={request.it_executive_person_id ? nameOf(request.it_executive_person_id) : null}
          />

          {isManager && !isFinished && (
            <section className={`${cardClass} p-5`}>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Assigned to</h2>
              <form action={assignChecklistItem.bind(null, request.id, item.id)} className="flex gap-2">
                {taskPageField}
                <select
                  name="assigneeId"
                  defaultValue={item.assigned_to_person_id ?? ""}
                  aria-label="Assignee"
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
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeeFacts({
  request,
  keys,
  nameById,
  companyEmail,
  accountName,
  executiveName,
}: {
  request: ItLifecycleRequest;
  keys: FactKey[];
  nameById: Map<string, string>;
  companyEmail: string | null;
  accountName: string | null;
  executiveName: string | null;
}) {
  const show = (k: FactKey) => keys.includes(k);
  return (
    <section className={`${cardClass} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Employee</h2>
        <StatusPill label={request.kind} tone={KIND_TONE[request.kind]} />
      </div>
      <dl className="space-y-3">
        <Fact label="Name">
          {request.employee_name}
          {request.employee_code && ` (${request.employee_code})`}
        </Fact>
        {show("designation") && <Fact label="Designation">{request.designation ?? "—"}</Fact>}
        {show("department") && (
          <Fact label="Department">{(request.department_id && nameById.get(request.department_id)) ?? "—"}</Fact>
        )}
        <Fact label="Location">{(request.site_id && nameById.get(request.site_id)) ?? "—"}</Fact>
        {request.joining_date && <Fact label="Joining date">{formatDate(request.joining_date)}</Fact>}
        {request.last_working_date && (
          <Fact label="Last working date">{formatDate(request.last_working_date)}</Fact>
        )}
        {show("personalEmail") && request.personal_email && (
          <Fact label="Personal email">{request.personal_email}</Fact>
        )}
        {show("companyEmail") && request.kind === "Onboarding" && (
          <Fact label="Company email">
            {request.email_required ? (companyEmail ?? "Not created yet") : "Not needed"}
          </Fact>
        )}
        {show("laptop") && request.kind === "Onboarding" && (
          <Fact label="Laptop required">{request.laptop_required ? "Yes" : "No"}</Fact>
        )}
        {show("account") && <Fact label="Portal account">{accountName ?? "Not linked yet"}</Fact>}
        {show("software") && request.software_required && (
          <Fact label="Software required">
            <span className="whitespace-pre-wrap">{request.software_required}</span>
          </Fact>
        )}
        {show("access") && request.access_required && (
          <Fact label="Access required">
            <span className="whitespace-pre-wrap">{request.access_required}</span>
          </Fact>
        )}
        {show("knownAssets") && request.known_assets_accesses && (
          <Fact label="Known assets / accesses">
            <span className="whitespace-pre-wrap">{request.known_assets_accesses}</span>
          </Fact>
        )}
        {request.remarks && (
          <Fact label="HR remarks">
            <span className="whitespace-pre-wrap">{request.remarks}</span>
          </Fact>
        )}
        <Fact label="IT Executive">{executiveName ?? "Not picked up yet"}</Fact>
      </dl>
    </section>
  );
}
