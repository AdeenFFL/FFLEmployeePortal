"use client";

import { useRef, useState } from "react";

export type WizardStep = {
  title: string;
  // Finished: the next step opens, and this one shows a tick.
  done: boolean;
  // Shown under a disabled Next while this step is not finished.
  nextHint: string;
  content: React.ReactNode;
};

const CHECK = "✓";

// The HR part as a wizard: one step at a time with Back / Next, a step bar on top, and a short
// slide + fade between steps. Every step stays mounted (only hidden), so unsaved typing is kept
// when moving between steps. The step is local state, never in the URL.
export function HrWizard({ steps, initialStep }: { steps: WizardStep[]; initialStep: number }) {
  const [step, setStep] = useState(initialStep);
  const [direction, setDirection] = useState<"right" | "left" | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // A step can be opened once every step before it is finished.
  const canOpen = (i: number) => steps.slice(0, i).every((s) => s.done);
  const current = steps[step];

  function go(to: number) {
    if (to === step || to < 0 || to >= steps.length || !canOpen(to)) return;
    setDirection(to > step ? "right" : "left");
    setStep(to);
    // Bring the top of the wizard into view if the user had scrolled down.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) {
      top.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const filled = steps.length > 1 ? (step / (steps.length - 1)) * 100 : 100;

  return (
    <div ref={topRef} className="flex scroll-mt-4 flex-col gap-6">
      {/* Step bar */}
      <nav aria-label="Steps" className="relative">
        <div className="absolute left-4 right-4 top-4 h-0.5 bg-slate-200" aria-hidden>
          <div
            className="h-full bg-blue-600 transition-all duration-500 ease-out"
            style={{ width: `${filled}%` }}
          />
        </div>
        <ol className="relative flex justify-between gap-2">
          {steps.map((s, i) => {
            const active = i === step;
            const open = canOpen(i);
            return (
              <li key={s.title} className="flex flex-1 flex-col items-center gap-2 first:items-start last:items-end">
                <button
                  type="button"
                  onClick={() => go(i)}
                  disabled={!open}
                  aria-current={active ? "step" : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : s.done
                        ? "border-green-600 bg-green-600 text-white hover:bg-green-700"
                        : open
                          ? "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"
                          : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {s.done && !active ? CHECK : i + 1}
                </button>
                <span
                  className={`text-xs font-medium sm:text-sm ${
                    active ? "text-slate-900" : open ? "text-slate-600" : "text-slate-400"
                  }`}
                >
                  {s.title}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Steps: all mounted, only the current one shown */}
      <div className="overflow-hidden">
        {steps.map((s, i) => (
          <div
            key={s.title}
            hidden={i !== step}
            className={
              i === step && direction
                ? direction === "right"
                  ? "animate-wizard-in-right"
                  : "animate-wizard-in-left"
                : undefined
            }
          >
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Step {i + 1} of {steps.length}: {s.title}
            </h2>
            {s.content}
          </div>
        ))}
      </div>

      {/* Back / Next */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              ← Back
            </button>
          )}
        </div>
        {step < steps.length - 1 && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {!current.done && <span className="text-xs text-slate-500">{current.nextHint}</span>}
            <button
              type="button"
              onClick={() => go(step + 1)}
              disabled={!current.done}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
