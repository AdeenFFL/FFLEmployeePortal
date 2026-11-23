import type { TaskBallState } from "@/components/task-progress";

type Step = {
  id: string;
  label: string;
  state: TaskBallState;
  // Who signed / why skipped / waiting: shown small, in full on hover.
  meta?: string;
  // Show the meta in amber (missing signer, overdue).
  warn?: boolean;
  // Controls under the step (e.g. Skip / Undo).
  extra?: React.ReactNode;
};

const CIRCLE: Record<TaskBallState, string> = {
  done: "border-emerald-500 bg-emerald-500 text-white",
  active: "border-emerald-500 bg-white",
  pending: "border-slate-300 bg-white",
  skipped: "border-slate-300 bg-slate-100",
};
const LABEL: Record<TaskBallState, string> = {
  done: "text-emerald-700",
  active: "text-slate-900",
  pending: "text-slate-400",
  skipped: "text-slate-400 line-through decoration-slate-300",
};

// The request's progress as one row of circles joined by a line (same colours as the shared
// vertical stepper), so it takes little height. Scrolls sideways on a narrow screen.
export function HorizontalSteps({ steps }: { steps: Step[] }) {
  const doneCount = steps.filter(
    (s) => s.state === "done" || s.state === "skipped",
  ).length;
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className="flex min-w-32 flex-1 flex-col items-center gap-1.5 px-1 text-center"
          >
            <div className="flex w-full items-center">
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${i === 0 ? "invisible" : steps[i - 1].state === "done" ? "bg-emerald-500" : "bg-slate-200"}`}
              />
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${CIRCLE[s.state]}`}
              >
                {s.state === "done" ? (
                  "✓"
                ) : s.state === "active" ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                ) : null}
              </span>
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${i === steps.length - 1 ? "invisible" : s.state === "done" ? "bg-emerald-500" : "bg-slate-200"}`}
              />
            </div>
            <span className={`text-xs font-medium ${LABEL[s.state]}`}>
              {s.label}
            </span>
            {s.meta && (
              <span
                className={`line-clamp-2 max-w-36 text-[11px] leading-tight ${s.warn ? "font-medium text-amber-700" : "text-slate-400"}`}
                title={s.meta}
              >
                {s.meta}
              </span>
            )}
            {s.extra && (
              <div className="flex flex-wrap justify-center gap-2">
                {s.extra}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-400">
        {doneCount}/{steps.length} done
      </p>
    </div>
  );
}
