import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { canManageSite, fetchPersonNames, fetchTicketScope, hasItPermission } from "@/lib/it/ticket-data";
import { formatDateTime, TASK_STATUS_TONE, TASK_STATUSES } from "@/lib/it/tickets";
import { TASK_KIND_DETAIL_FIELDS, TASK_KIND_LABELS } from "@/lib/it/ticket-tasks";
import { updateTaskStatus } from "../../../actions";
import {
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../../../_components/ticket-ui";

// One ticket task on its own screen (My Tasks → a task), mirroring
// /it/onboarding/[id]/tasks/[taskId]: only its assignee (lead or extra) or whoever can manage the
// ticket's handling site may open it. Shows just the ticket facts the task needs and the one form
// that completes it (Unified Ticket/Task Tracker, Phase 4).
export default async function TicketTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id, taskId }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const [{ data: ticket }, { data: task }, { data: personId }] = await Promise.all([
    supabase
      .schema("it")
      .from("tickets")
      .select("id, ticket_number, subject, status, handling_site_id, assigned_to_person_id")
      .eq("id", id)
      .maybeSingle(),
    supabase.schema("it").from("ticket_tasks").select("*").eq("id", taskId).eq("ticket_id", id).maybeSingle(),
    supabase.rpc("current_person_id"),
  ]);
  if (!ticket || !task) notFound();

  const [canUpdate, scope, { data: extras }] = await Promise.all([
    hasItPermission(supabase, "it.tickets.update"),
    fetchTicketScope(supabase),
    supabase.schema("it").from("ticket_task_assignees").select("person_id").eq("task_id", taskId),
  ]);
  const canAssign = canManageSite(scope, ticket.handling_site_id);
  const extraIds = (extras ?? []).map((e) => e.person_id);
  const isMine = Boolean(personId) && (task.assigned_to_person_id === personId || extraIds.includes(personId ?? ""));
  const isManager = canAssign;

  if (!isMine && !isManager) {
    return (
      <div className="py-6">
        <PageHeader
          title={task.task_type}
          description={`${ticket.ticket_number} · ${ticket.subject}`}
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

  const isClosed = ticket.status === "Closed";
  const isOpen = task.status === "Pending" || task.status === "In Progress";
  const canWork = !isClosed && canUpdate && (isMine || canAssign);

  const names = await fetchPersonNames(supabase, [task.assigned_to_person_id, ...extraIds]);
  const nameOf = (pid: string | null) => (pid ? (names.get(pid) ?? "—") : "—");

  const fields = task.task_kind ? TASK_KIND_DETAIL_FIELDS[task.task_kind] : [];
  const recorded = fields.filter((f) => task.details?.[f.key]);
  const taskPageField = <input type="hidden" name="taskPage" value={task.id} />;

  return (
    <div className="py-6">
      <PageHeader
        title={task.task_type}
        description={`${ticket.ticket_number} · ${ticket.subject}`}
        action={
          <div className="flex gap-2">
            <Link href={`/it/tickets/${ticket.id}`} className={secondaryButtonClass}>
              Whole ticket
            </Link>
            <Link href="/it/my-work" className={secondaryButtonClass}>
              My Tasks
            </Link>
          </div>
        }
      />
      <FormMessage error={sp.error} notice={sp.notice} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm text-slate-500">
                <p>
                  {task.assigned_to_person_id
                    ? task.assigned_to_person_id === personId
                      ? "Assigned to you"
                      : `Assigned to ${nameOf(task.assigned_to_person_id)}`
                    : "Unassigned"}
                  {extraIds.length > 0 && ` + ${extraIds.map((pid) => nameOf(pid)).join(", ")}`}
                </p>
                {task.completed_at && <p>{task.status} on {formatDateTime(task.completed_at)}</p>}
              </div>
              <StatusPill label={task.status} tone={TASK_STATUS_TONE[task.status]} />
            </div>

            {task.description && <p className="mb-4 text-sm text-slate-700">{task.description}</p>}

            {isClosed && (
              <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                This ticket is closed; nothing more to do here.
              </p>
            )}

            {recorded.length > 0 && !canWork && (
              <dl className="mb-4 grid gap-3 sm:grid-cols-2">
                {recorded.map((f) => (
                  <Fact key={f.key} label={f.label}>
                    <span className="whitespace-pre-wrap">{task.details[f.key]}</span>
                  </Fact>
                ))}
              </dl>
            )}

            {canWork ? (
              <form action={updateTaskStatus.bind(null, ticket.id, task.id)} className="space-y-3 rounded-lg border border-slate-200 p-4">
                {taskPageField}
                {fields.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-slate-500">{TASK_KIND_LABELS[task.task_kind!]}</p>
                    {fields.map((f) => (
                      <label key={f.key} className="block">
                        <span className={labelClass}>{f.label}</span>
                        <input
                          name={`detail_${f.key}`}
                          defaultValue={task.details?.[f.key] ?? ""}
                          placeholder={f.placeholder}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </>
                )}
                <div className="flex gap-2">
                  <select name="status" defaultValue={task.status} aria-label="Task status" className={inputClass}>
                    {TASK_STATUSES.map((s) => (
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
              !isClosed &&
              isOpen && <p className="text-sm text-amber-700">You can&apos;t update this task.</p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className={`${cardClass} p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ticket</h2>
            <dl className="space-y-3">
              <Fact label="Reference">
                <Link href={`/it/tickets/${ticket.id}`} className="font-medium text-blue-700 hover:underline">
                  {ticket.ticket_number}
                </Link>
              </Fact>
              <Fact label="Subject">{ticket.subject}</Fact>
              <Fact label="Status">{ticket.status}</Fact>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
