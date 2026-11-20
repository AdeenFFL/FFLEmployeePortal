import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Modal } from "@/components/modal";
import { TaskProgressSummary, type TaskBallState } from "@/components/task-progress";
import { AssetAllocationForm } from "../_components/asset-allocation-form";
import { RequestDetails } from "../_components/request-details";
import { AssetReturnForm } from "../../inventory/_components/asset-return-form";
import { listOpenAssignments } from "@/lib/it/assets";
import { checked, fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import {
  CHECKLIST_STATUSES,
  CHECKLIST_STATUS_TONE,
  FINISHED_STATUSES,
  TASK_DETAIL_FIELDS,
  taskGuide,
} from "@/lib/it/onboarding";
import { formatDateTime } from "@/lib/it/tickets";
import {
  addChecklistItem,
  addLifecycleUpdate,
  assignChecklistItem,
  cancelRequest,
  closeRequest,
  completeEmailAccountTask,
  completeHandoverTask,
  completePortalAccountTask,
  deactivatePortalAccess,
  linkOnboardingPerson,
  signOffboarding,
  takeOwnership,
  updateChecklistItem,
} from "../actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
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
  searchParams: Promise<{
    notice?: string;
    error?: string;
    q?: string;
    updateTask?: string;
    cancel?: string;
    returnAsset?: string;
  }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { notice, error, q } = sp;
  const supabase = await createClient();
  const basePath = `/it/onboarding/${id}`;

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
    canAssignAssets,
    canManageUsers,
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
    hasItPermission(supabase, "it.assets.assign"),
    hasItPermission(supabase, "route:/admin/users"),
  ]);

  const checklist = items ?? [];
  const isFinished = FINISHED_STATUSES.includes(request.status);
  const portalTask = checklist.find((i) => i.task_type === "portal_account");
  const canLink =
    request.kind === "Onboarding" &&
    !request.person_id &&
    !isFinished &&
    (canAssign || (portalTask && portalTask.assigned_to_person_id === personId));

  // Who sees what on the checklist:
  //   * whoever runs the request (can assign onboarding work, or is its IT Executive): every task;
  //   * IT staff holding tasks on it: only their own tasks, with how to complete each one;
  //   * anyone else who can read the request (HR): just how far IT has got.
  const isManager = canAssign || (Boolean(personId) && request.it_executive_person_id === personId);
  const myTasks = checklist.filter((i) => Boolean(personId) && i.assigned_to_person_id === personId);
  const showChecklist = isManager || myTasks.length > 0;
  const visibleTasks = isManager ? checklist : myTasks;

  const assignmentIds = checklist
    .map((i) => i.assignment_id)
    .filter((aid): aid is string => Boolean(aid));

  const hasOpenPortalAccountTask = checklist.some(
    (i) => i.task_type === "portal_account" && i.status !== "Completed",
  );

  const [names, { data: candidates }, { data: assignedAssets }, { data: leaverAccount }, { data: roles }] =
    await Promise.all([
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
    assignmentIds.length
      ? supabase
          .schema("it")
          .from("asset_assignments")
          .select("id, acknowledged_at, assets(asset_tag, asset_name)")
          .in("id", assignmentIds)
      : Promise.resolve({ data: null }),
    // persons is admin-only under RLS ("persons select own or admin") — an IT Executive
    // viewing someone else's offboarding can't read their status via their own session, so
    // this one read uses the admin client, same justification as deactivatePortalAccess.
    request.kind === "Offboarding" && request.person_id && canAssign
      ? createAdminClient().from("persons").select("status").eq("id", request.person_id).maybeSingle()
      : Promise.resolve({ data: null }),
    hasOpenPortalAccountTask && canAssign
      ? supabase.from("roles").select("id, name").order("name")
      : Promise.resolve({ data: null }),
  ]);
  // Employee account (onboarding): the staged sign-in invite and, once they have signed in, their
  // role. invited_users / user_roles are admin-only under RLS; read here only for the request's
  // managers, same justification as the leaver-account read above.
  const showAccount = request.kind === "Onboarding" && isManager;
  const accountAdmin = showAccount ? createAdminClient() : null;
  const [{ data: accountInvite }, { data: accountRoles }, { data: allRoles }] = accountAdmin
    ? await Promise.all([
        accountAdmin
          .from("invited_users")
          .select("email, role_id, invited_at")
          .eq("onboarding_request_id", request.id)
          .maybeSingle(),
        request.person_id
          ? accountAdmin.from("user_roles").select("role_id").eq("person_id", request.person_id)
          : Promise.resolve({ data: null }),
        accountAdmin.from("roles").select("id, name"),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const roleName = new Map((allRoles ?? []).map((r) => [r.id, r.name]));
  const emailTask = checklist.find((i) => i.task_type === "email_account");
  const companyEmail = emailTask?.details?.email_address ?? null;

  const assetByAssignmentId = new Map(
    (assignedAssets ?? []).map((a) => [a.id, a.assets as unknown as { asset_tag: string; asset_name: string } | null]),
  );
  const acknowledgedAtByAssignmentId = new Map(
    (assignedAssets ?? []).map((a) => [a.id, a.acknowledged_at as string | null]),
  );
  const allocationAssignmentId = checklist.find((i) => i.task_type === "asset_allocation")?.assignment_id ?? null;

  // What the leaver still holds; each return goes back to stock with its condition.
  const leaverAssets =
    request.kind === "Offboarding" && request.person_id ? await listOpenAssignments(supabase, request.person_id) : [];
  const returning = leaverAssets.find((a) => a.id === sp.returnAsset);

  const nameOf = (pid: string | null) => (pid ? (names.get(pid) ?? "—") : "—");
  const done = checklist.filter((i) => i.status === "Completed" || i.status === "Not Applicable");
  const ballStateOf = (status: (typeof checklist)[number]["status"]): TaskBallState =>
    status === "Completed"
      ? "done"
      : status === "Not Applicable"
        ? "skipped"
        : status === "In Progress"
          ? "active"
          : "pending";
  const checklistBalls = checklist.map((i) => ({
    id: i.id,
    label: i.task_name,
    state: ballStateOf(i.status),
  }));

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
          <RequestDetails request={request} nameById={orgUnits.nameById} />

          {/* Checklist */}
          {showChecklist ? (
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-900">{isManager ? "Checklist" : "Your tasks"}</h2>
              <span className="text-sm text-slate-500">
                {isManager
                  ? `${done.length}/${checklist.length} done`
                  : `${myTasks.filter((i) => i.status === "Completed" || i.status === "Not Applicable").length}/${myTasks.length} of yours done · ${done.length}/${checklist.length} overall`}
              </span>
            </div>
            <TaskProgressSummary tasks={checklistBalls} className="mb-4" />

            <ul className="space-y-3">
              {visibleTasks.map((item) => {
                const isMine = Boolean(personId) && item.assigned_to_person_id === personId;
                const canWork = !isFinished && (canAssign || (canUpdate && isMine));
                const fields = TASK_DETAIL_FIELDS[item.task_type] ?? [];
                const recorded = fields.filter((f) => item.details?.[f.key]);
                return (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`${basePath}/tasks/${item.id}`}
                          className="text-sm font-medium text-slate-900 hover:text-blue-700 hover:underline"
                        >
                          {item.task_name}
                        </Link>
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

                    {(isMine || isManager) &&
                      !isFinished &&
                      (item.status === "Pending" || item.status === "In Progress") && (
                        <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
                          <span className="font-semibold">How to complete: </span>
                          {taskGuide(item.task_type, request.kind, request.email_required)}
                        </p>
                      )}

                    {item.task_type === "asset_allocation" && item.assignment_id && (
                      <p className="mt-2 text-xs text-emerald-700">
                        {assetByAssignmentId.get(item.assignment_id)
                          ? `Assigned: ${assetByAssignmentId.get(item.assignment_id)!.asset_tag} — ${assetByAssignmentId.get(item.assignment_id)!.asset_name}`
                          : "Asset assigned"}
                      </p>
                    )}

                    {item.task_type === "asset_handover" && (
                      <p className="mt-2 text-xs text-slate-500">
                        {!allocationAssignmentId
                          ? "No asset assigned yet."
                          : acknowledgedAtByAssignmentId.get(allocationAssignmentId)
                            ? `Acknowledged by the employee on ${formatDateTime(acknowledgedAtByAssignmentId.get(allocationAssignmentId)!)}.`
                            : "Awaiting the employee's acknowledgement (My Assets)."}
                      </p>
                    )}

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

                    {item.task_type === "asset_allocation" ? (
                      canAssignAssets &&
                      !isFinished &&
                      request.person_id &&
                      item.status !== "Completed" && (
                        <Link
                          href={`${basePath}?updateTask=${item.id}`}
                          className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline"
                        >
                          Assign an asset
                        </Link>
                      )
                    ) : item.task_type === "asset_handover" ? (
                      canAssign &&
                      !isFinished &&
                      item.status !== "Completed" &&
                      allocationAssignmentId &&
                      acknowledgedAtByAssignmentId.get(allocationAssignmentId) && (
                        <form action={completeHandoverTask.bind(null, request.id, item.id)} className="mt-3">
                          <button type="submit" className="text-sm font-medium text-blue-700 hover:underline">
                            Mark handover confirmed
                          </button>
                        </form>
                      )
                    ) : item.task_type === "portal_account" ? (
                      canAssign &&
                      !isFinished &&
                      item.status !== "Completed" && (
                        <Link
                          href={`${basePath}?updateTask=${item.id}`}
                          className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline"
                        >
                          Create portal account
                        </Link>
                      )
                    ) : (
                      canWork && (
                        <Link
                          href={`${basePath}?updateTask=${item.id}`}
                          className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline"
                        >
                          Update task
                        </Link>
                      )
                    )}
                  </li>
                );
              })}
            </ul>

            {visibleTasks.map((item) => {
              if (sp.updateTask !== item.id) return null;

              if (item.task_type === "asset_allocation") {
                if (!canAssignAssets || isFinished || !request.person_id) return null;
                return (
                  <Modal key={Date.now()} closeHref={basePath} title={`Assign asset: ${item.task_name}`}>
                    <AssetAllocationForm requestId={request.id} itemId={item.id} />
                  </Modal>
                );
              }

              if (item.task_type === "portal_account") {
                if (!canAssign || isFinished) return null;
                const defaultRoleId = (roles ?? []).find((r) => r.name === "Employee")?.id ?? "";
                return (
                  <Modal key={Date.now()} closeHref={basePath} title="Create portal account">
                    <form action={completePortalAccountTask.bind(null, request.id, item.id)} className="space-y-3">
                      <p className="text-xs text-slate-500">
                        Pick the role to create or upgrade their portal account with. Defaults to
                        the baseline Employee role — change it if they need something else.
                      </p>
                      <div>
                        <label className={labelClass}>Role *</label>
                        <select name="roleId" required defaultValue={defaultRoleId} className={inputClass}>
                          <option value="" disabled>
                            Select…
                          </option>
                          {(roles ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className={primaryButtonClass}>
                        Create account
                      </button>
                    </form>
                  </Modal>
                );
              }

              const isMine = Boolean(personId) && item.assigned_to_person_id === personId;
              const canWork = !isFinished && (canAssign || (canUpdate && isMine));
              const fields = TASK_DETAIL_FIELDS[item.task_type] ?? [];
              if (!canWork) return null;
              // Completing this with a real address also stages the new hire's portal invite
              // (completeEmailAccountTask) — same fields, different action, so the fallback
              // generic form below is reused rather than duplicated.
              const action =
                item.task_type === "email_account"
                  ? completeEmailAccountTask.bind(null, request.id, item.id)
                  : updateChecklistItem.bind(null, request.id, item.id);
              return (
                <Modal key={Date.now()} closeHref={basePath} title={`Update: ${item.task_name}`}>
                  <form action={action} className="space-y-3">
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
                </Modal>
              );
            })}

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
          ) : (
            <section className={`${cardClass} p-6`}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-slate-900">IT progress</h2>
                <span className="text-sm text-slate-500">
                  {done.length}/{checklist.length} tasks done
                </span>
              </div>
              <TaskProgressSummary tasks={checklistBalls} className="mt-3" />
              <p className="mt-3 text-xs text-slate-500">IT works through its checklist; the status above shows when it is finished.</p>
              {canUpdate && (
                <p className="mt-2 text-xs text-slate-500">No task on this request is assigned to you.</p>
              )}
            </section>
          )}

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

          {showAccount && (
            <Panel title="Employee account">
              <ol className="space-y-3 text-sm">
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">1 · Company email</p>
                  <p className="text-slate-700">
                    {!request.email_required
                      ? `Not needed: signs in with ${request.personal_email ?? "their personal email"}`
                      : companyEmail
                        ? companyEmail
                        : "Not created yet (Email Account task)"}
                  </p>
                </li>
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    2 · {request.email_required ? "Sign-in invite" : "Set-password email"}
                  </p>
                  <p className="text-slate-700">
                    {!request.email_required
                      ? `Sent to ${request.personal_email ?? "their personal email"} when the request was raised`
                      : request.person_id
                        ? "Accepted: they have signed in"
                        : accountInvite
                          ? `Sent to ${accountInvite.email} · role ${roleName.get(accountInvite.role_id) ?? "—"}`
                          : "Not sent yet: goes out when the Email Account task is completed with the address"}
                  </p>
                  {accountInvite && !request.person_id && (
                    <p className="text-xs text-slate-500">
                      The role is set by the Portal Account task. Listed under User Management → Pending Invitations.
                    </p>
                  )}
                </li>
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">3 · Portal account</p>
                  <p className="text-slate-700">
                    {request.person_id
                      ? `${nameOf(request.person_id)} · ${
                          (accountRoles ?? []).map((r) => roleName.get(r.role_id)).filter(Boolean).join(", ") || "no role"
                        }`
                      : request.email_required
                        ? "Not yet: created the first time they sign in with the company email, then linked here by itself"
                        : "Not linked: link the account under Employee Portal Account Creation"}
                  </p>
                </li>
              </ol>
              {canManageUsers && (
                <Link href="/admin/users" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline">
                  Open User Management
                </Link>
              )}
            </Panel>
          )}

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

          {request.kind === "Offboarding" && request.person_id && (canAssignAssets || leaverAssets.length > 0) && (
            <Panel title="Assets to return">
              {leaverAssets.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing left to return.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {leaverAssets.map((a) => {
                    const asset = a.assets as unknown as { asset_tag: string; asset_name: string } | null;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <Link href={`/it/inventory/${a.asset_id}`} className="min-w-0 hover:underline">
                          <span className="font-mono text-xs text-slate-500">{asset?.asset_tag}</span>{" "}
                          <span className="text-slate-900">{asset?.asset_name}</span>
                        </Link>
                        {canAssignAssets && !isFinished && (
                          <Link href={`${basePath}?returnAsset=${a.id}`} className="shrink-0 font-medium text-blue-700 hover:underline">
                            Record return
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}
          {canAssignAssets && returning && !isFinished && (
            <Modal key={Date.now()} closeHref={basePath} title="Return asset">
              <AssetReturnForm
                assetId={returning.asset_id}
                assignedDate={returning.assigned_date}
                assignedCondition={returning.assigned_condition}
                holderName={nameOf(request.person_id)}
                returnTo={basePath}
              />
            </Modal>
          )}

          {request.kind === "Offboarding" && request.person_id && canAssign && (
            <Panel title="Portal access">
              <p className="mb-3 text-sm text-slate-700">
                {leaverAccount?.status === "Inactive" ? (
                  <span className="font-medium text-red-600">Deactivated</span>
                ) : (
                  "Still active — the employee can still log in."
                )}
              </p>
              {leaverAccount?.status !== "Inactive" && (
                <form action={deactivatePortalAccess.bind(null, request.id)}>
                  <button
                    type="submit"
                    className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Deactivate portal access
                  </button>
                </form>
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
              <Link
                href={`${basePath}?cancel=1`}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Cancel request
              </Link>
            </Panel>
          )}
          {canAssign &&
            ["Open", "Under Review", "In Progress"].includes(request.status) &&
            sp.cancel === "1" && (
              <Modal key={Date.now()} closeHref={basePath} title="Cancel request">
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
              </Modal>
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
