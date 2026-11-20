import Link from "next/link";

// A simple vertical progress stepper for a task list: one connected step per task, ordered,
// checked off as they complete — used on both the ticket detail page's Tasks section and the
// onboarding detail page's checklist section. Replaces an earlier horizontal "balls" row that
// tried to pack too much into one line; this reads top to bottom like the step trackers people
// already know, and each step is clickable through to that task's own page when a href is given.
//
// Callers map their own status enum (ItTicketTaskStatus / ItChecklistStatus) into this small,
// shared vocabulary rather than this component knowing about either.
export type TaskBallState = "done" | "active" | "pending" | "skipped";

type Task = { id: string; label: string; state: TaskBallState; href?: string };

const CIRCLE_STYLE: Record<TaskBallState, string> = {
  done: "border-emerald-500 bg-emerald-500",
  active: "border-emerald-500 bg-white",
  pending: "border-slate-300 bg-white",
  skipped: "border-slate-300 bg-slate-100",
};

const LABEL_STYLE: Record<TaskBallState, string> = {
  done: "text-emerald-700",
  active: "text-slate-900",
  pending: "text-slate-400",
  skipped: "text-slate-400 line-through decoration-slate-300",
};

const LINE_STYLE: Record<TaskBallState, string> = {
  done: "bg-emerald-500",
  active: "bg-slate-200",
  pending: "bg-slate-200",
  skipped: "bg-slate-200",
};

function Circle({ state }: { state: TaskBallState }) {
  if (state === "done") {
    return (
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${CIRCLE_STYLE.done}`}>
        <svg viewBox="0 0 20 20" fill="white" className="h-3.5 w-3.5">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.8a1 1 0 0 1 1.4 0Z"
          />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${CIRCLE_STYLE.active}`}>
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    );
  }
  return <span className={`h-6 w-6 rounded-full border-2 ${CIRCLE_STYLE[state]}`} />;
}

export function TaskProgressSummary({ tasks, className = "" }: { tasks: Task[]; className?: string }) {
  if (tasks.length === 0) return null;
  // "Done" for the fraction matches what callers already counted before this component existed
  // (onboarding's own `done.length`): Completed and Not Applicable both count as finished.
  const doneCount = tasks.filter((t) => t.state === "done" || t.state === "skipped").length;

  return (
    <div className={className}>
      <ul>
        {tasks.map((t, i) => {
          const content = (
            <div className="flex items-center gap-3 px-1 py-1">
              <Circle state={t.state} />
              <span className={`text-sm font-medium ${LABEL_STYLE[t.state]}`}>{t.label}</span>
            </div>
          );
          return (
            <li key={t.id} className="relative pb-6 last:pb-0">
              {i < tasks.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute left-[15px] top-6 w-0.5 ${LINE_STYLE[t.state]}`}
                  style={{ height: "calc(100% - 1.5rem)" }}
                />
              )}
              {t.href ? (
                <Link href={t.href} className="block rounded-md hover:bg-slate-50">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 px-1 text-xs text-slate-400">
        {doneCount}/{tasks.length} done
      </p>
    </div>
  );
}
