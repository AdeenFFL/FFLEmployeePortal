// A compact, at-a-glance summary of a variable-length task list: one small "ball" per task,
// ordered, colored by state, plus a "done" fraction — used on both the ticket detail page's
// Tasks section and the onboarding detail page's checklist section (Unified Ticket/Task Tracker
// plan, Phase 1). Deliberately NOT the procurement demand page's `Steps` stepper, which shows a
// fixed, named workflow sequence — our tasks are a variable, per-request list of independent
// items, not ordered stages, so there's no "current step" and no connector line between balls.
//
// Callers map their own status enum (ItTicketTaskStatus / ItChecklistStatus) into this small,
// shared vocabulary rather than this component knowing about either.
export type TaskBallState = "done" | "active" | "pending" | "skipped";

const STATE_STYLE: Record<TaskBallState, string> = {
  done: "border-emerald-500 bg-emerald-500",
  active: "border-amber-400 bg-amber-400",
  pending: "border-slate-300 bg-white",
  skipped: "border-slate-300 bg-slate-200",
};

const STATE_LABEL: Record<TaskBallState, string> = {
  done: "Completed",
  active: "In progress",
  pending: "Pending",
  skipped: "Not applicable",
};

export function TaskProgressSummary({
  tasks,
  className = "",
}: {
  tasks: { id: string; label: string; state: TaskBallState }[];
  className?: string;
}) {
  if (tasks.length === 0) return null;
  // "Done" for the fraction matches what callers already counted before this component existed
  // (onboarding's own `done.length`): Completed and Not Applicable both count as finished.
  const doneCount = tasks.filter((t) => t.state === "done" || t.state === "skipped").length;

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tasks.map((t) => (
          <span
            key={t.id}
            title={`${t.label} — ${STATE_LABEL[t.state]}`}
            aria-label={`${t.label}: ${STATE_LABEL[t.state]}`}
            className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${STATE_STYLE[t.state]}`}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs text-slate-500">
        {doneCount}/{tasks.length} done
      </span>
    </div>
  );
}
