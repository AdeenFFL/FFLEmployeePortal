import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { CHECKLIST_STATUS_TONE } from "@/lib/it/onboarding";
import { formatDate, STATUS_TONE, TASK_STATUS_TONE } from "@/lib/it/tickets";
import { cardClass, FormMessage, PriorityBadge } from "../_components/ticket-ui";
import type { ItTicketPriority } from "@/types/database";

type Tone = "positive" | "neutral" | "warning" | "negative" | "info";
type WorkKind = "ticket" | "ticket_task" | "onboarding" | "clearance";
type Row = {
  key: string;
  kind: WorkKind;
  href: string;
  reference: string;
  title: string;
  context: string;
  status: string;
  tone: Tone;
  priority: ItTicketPriority | null;
  due: string | null;
  sortAt: string;
};

const KIND_LABEL: Record<WorkKind, string> = {
  ticket: "Ticket",
  ticket_task: "Ticket task",
  onboarding: "Onboarding task",
  clearance: "Clearance",
};

// Rows of hr.my_clearance_tasks() / hr.my_clearance_asset_tasks() (only my own; see
// /hr/clearance/tasks): grouped into one row per leaving employee.
type ClearanceRow = {
  case_id: string;
  case_number: string;
  employee_name: string;
  last_working_date: string;
  case_status: string;
  part_locked: boolean;
  assigned_at: string;
};
type ClearanceLine = ClearanceRow & { outcome: string | null };
type ClearanceAsset = ClearanceRow & { returned: boolean };

const SHOWS = ["open", "done"] as const;
const TYPES = [
  { key: "all", label: "Everything" },
  { key: "tickets", label: "Tickets" },
  { key: "onboarding", label: "On/offboarding tasks" },
  { key: "clearance", label: "Clearance" },
] as const;

// My Tasks: everything assigned to me in IT, in one list — tickets, tasks on tickets, and
// onboarding / offboarding / replacement checklist tasks. Each row opens the screen for that one
// piece of work (an onboarding task opens its own task page, not the whole request).
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; type?: string; notice?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const show = SHOWS.find((s) => s === sp.show) ?? "open";
  const type = TYPES.find((t) => t.key === sp.type)?.key ?? "all";
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const wantTickets = type === "all" || type === "tickets";
  const wantOnboarding = type === "all" || type === "onboarding";
  const wantClearance = type === "all" || type === "clearance";
  const doneLimit = 50;

  const [{ data: tickets }, { data: ticketTasks }, { data: checklist }, clearanceLines, clearanceAssets] =
    await Promise.all([
    personId && wantTickets
      ? (() => {
          const q = supabase
            .schema("it")
            .from("tickets")
            .select("id, ticket_number, subject, priority, status, resolution_due_at, created_at, updated_at")
            .eq("assigned_to_person_id", personId);
          return show === "open"
            ? q.not("status", "in", "(Resolved,Closed)").order("created_at", { ascending: false })
            : q.in("status", ["Resolved", "Closed"]).order("updated_at", { ascending: false }).limit(doneLimit);
        })()
      : Promise.resolve({ data: null }),
    personId && wantTickets
      ? supabase
          .schema("it")
          .from("ticket_tasks")
          .select("id, ticket_id, task_type, description, status, created_at, completed_at")
          .eq("assigned_to_person_id", personId)
          .in("status", show === "open" ? ["Pending", "In Progress"] : ["Completed", "Cancelled"])
          .order("created_at", { ascending: false })
          .limit(show === "open" ? 200 : doneLimit)
      : Promise.resolve({ data: null }),
    personId && wantOnboarding
      ? supabase
          .schema("it")
          .from("checklist_items")
          .select("id, request_id, task_name, status, due_date, created_at, completed_at")
          .eq("assigned_to_person_id", personId)
          .in("status", show === "open" ? ["Pending", "In Progress"] : ["Completed", "Not Applicable"])
          .order("created_at", { ascending: false })
          .limit(show === "open" ? 200 : doneLimit)
      : Promise.resolve({ data: null }),
    // Missing before the clearance migrations are live: then simply no clearance rows.
    wantClearance ? supabase.schema("hr").rpc("my_clearance_tasks") : Promise.resolve({ data: null, error: null }),
    wantClearance ? supabase.schema("hr").rpc("my_clearance_asset_tasks") : Promise.resolve({ data: null, error: null }),
  ]);

  // Clearance: one row per leaving employee, open while their IT part is still being worked.
  const cases = new Map<string, { info: ClearanceRow; left: number; total: number; latest: string }>();
  const addClearance = (r: ClearanceRow, done: boolean) => {
    const c = cases.get(r.case_id) ?? { info: r, left: 0, total: 0, latest: "" };
    c.total += 1;
    if (!done) c.left += 1;
    if (r.assigned_at > c.latest) c.latest = r.assigned_at;
    cases.set(r.case_id, c);
  };
  for (const l of ((clearanceLines.error ? null : clearanceLines.data) ?? []) as ClearanceLine[]) {
    addClearance(l, Boolean(l.outcome));
  }
  for (const a of ((clearanceAssets.error ? null : clearanceAssets.data) ?? []) as ClearanceAsset[]) {
    addClearance(a, a.returned);
  }
  const clearanceRows = [...cases.values()].filter(({ info, left }) => {
    const open = info.case_status === "In Clearance" && !info.part_locked && left > 0;
    return show === "open" ? open : !open;
  });

  // The ticket / request each task belongs to.
  const ticketIds = [...new Set((ticketTasks ?? []).map((t) => t.ticket_id))];
  const requestIds = [...new Set((checklist ?? []).map((t) => t.request_id))];
  const [{ data: parentTickets }, { data: requests }] = await Promise.all([
    ticketIds.length
      ? supabase.schema("it").from("tickets").select("id, ticket_number, subject, priority").in("id", ticketIds)
      : Promise.resolve({ data: null }),
    requestIds.length
      ? supabase
          .schema("it")
          .from("onboarding_offboarding")
          .select("id, request_number, kind, employee_name, priority, status")
          .in("id", requestIds)
      : Promise.resolve({ data: null }),
  ]);
  const ticketById = new Map((parentTickets ?? []).map((t) => [t.id, t]));
  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));

  const rows: Row[] = [
    ...(tickets ?? []).map((t) => ({
      key: `t-${t.id}`,
      kind: "ticket" as const,
      href: `/it/tickets/${t.id}`,
      reference: t.ticket_number,
      title: t.subject,
      context: "",
      status: t.status,
      tone: STATUS_TONE[t.status],
      priority: t.priority,
      due: t.resolution_due_at,
      sortAt: show === "open" ? t.created_at : t.updated_at,
    })),
    ...(ticketTasks ?? []).map((t) => {
      const parent = ticketById.get(t.ticket_id);
      return {
        key: `tt-${t.id}`,
        kind: "ticket_task" as const,
        href: `/it/tickets/${t.ticket_id}/tasks/${t.id}`,
        reference: parent?.ticket_number ?? "Ticket",
        title: t.description ? `${t.task_type}: ${t.description}` : t.task_type,
        context: parent?.subject ?? "",
        status: t.status,
        tone: TASK_STATUS_TONE[t.status],
        priority: parent?.priority ?? null,
        due: null,
        sortAt: show === "open" ? t.created_at : (t.completed_at ?? t.created_at),
      };
    }),
    ...(checklist ?? []).map((t) => {
      const r = requestById.get(t.request_id);
      return {
        key: `c-${t.id}`,
        kind: "onboarding" as const,
        href: `/it/onboarding/${t.request_id}/tasks/${t.id}`,
        reference: r?.request_number ?? "Request",
        title: t.task_name,
        context: r ? `${r.kind} · ${r.employee_name}` : "",
        status: t.status,
        tone: CHECKLIST_STATUS_TONE[t.status],
        priority: r?.priority ?? null,
        due: t.due_date,
        sortAt: show === "open" ? t.created_at : (t.completed_at ?? t.created_at),
      };
    }),
    ...clearanceRows.map(({ info, left, total, latest }) => ({
      key: `cl-${info.case_id}`,
      kind: "clearance" as const,
      href: "/hr/clearance/tasks",
      reference: info.case_number,
      title: show === "open" ? `IT clearance: ${left} of ${total} still to do` : `IT clearance: ${total} item(s)`,
      context: info.employee_name,
      status: show === "open" ? "To do" : left > 0 ? "Closed" : "Done",
      tone: (show === "open" ? "warning" : "positive") as Tone,
      priority: null,
      due: info.last_working_date,
      sortAt: latest,
    })),
  ];

  // Open work: soonest due first (no due date last), then oldest first. Done: most recent first.
  rows.sort((a, b) => {
    if (show === "done") return b.sortAt.localeCompare(a.sortAt);
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.sortAt.localeCompare(b.sortAt);
  });

  const today = new Date().toISOString().slice(0, 10);
  const href = (next: { show?: string; type?: string }) => {
    const params = new URLSearchParams();
    const s = next.show ?? show;
    const t = next.type ?? type;
    if (s !== "open") params.set("show", s);
    if (t !== "all") params.set("type", t);
    const qs = params.toString();
    return `/it/my-work${qs ? `?${qs}` : ""}`;
  };
  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      active ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="py-6">
      <PageHeader
        title="My Tasks"
        description="Everything assigned to you in IT: tickets, ticket tasks, onboarding / offboarding tasks and clearance work."
      />
      <FormMessage error={sp.error} notice={sp.notice} />

      <nav aria-label="Filters" className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={href({ show: "open" })} aria-current={show === "open" ? "page" : undefined} className={pill(show === "open")}>
          To do
        </Link>
        <Link href={href({ show: "done" })} aria-current={show === "done" ? "page" : undefined} className={pill(show === "done")}>
          Done
        </Link>
        <span className="mx-2 h-5 w-px bg-slate-200" aria-hidden />
        {TYPES.map((t) => (
          <Link
            key={t.key}
            href={href({ type: t.key })}
            aria-current={type === t.key ? "page" : undefined}
            className={pill(type === t.key)}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">
            {show === "open" ? "Nothing assigned to you right now." : "Nothing finished yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const overdue = show === "open" && r.due && r.due.slice(0, 10) < today;
              return (
                <li key={r.key}>
                  <Link
                    href={r.href}
                    className="flex flex-col gap-2 px-5 py-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">
                        <span className="font-medium text-slate-600">{KIND_LABEL[r.kind]}</span>
                        {" · "}
                        <span className="font-medium text-blue-700">{r.reference}</span>
                        {r.context && ` · ${r.context}`}
                      </p>
                      <p className="truncate text-sm font-medium text-slate-900">{r.title}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {r.due && (
                        <span className={`text-xs ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                          {overdue ? "Overdue · " : "Due "}
                          {formatDate(r.due)}
                        </span>
                      )}
                      {r.priority && <PriorityBadge priority={r.priority} />}
                      <StatusPill label={r.status} tone={r.tone} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {show === "done" && rows.length >= doneLimit && (
        <p className="mt-2 text-xs text-slate-400">Showing the most recent {doneLimit} of each kind.</p>
      )}
    </div>
  );
}
