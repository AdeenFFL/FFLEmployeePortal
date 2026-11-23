"use client";

import { useState } from "react";
import {
  TaskProgressSummary,
  type TaskBallState,
} from "@/components/task-progress";

type Step = { id: string; label: string; state: TaskBallState; meta?: string };

// A small "Signatures 2/5" button for a card's corner: hover (or click / tap) shows who has signed
// as the shared vertical stepper, in a small panel. Replaces the Signatures card.
export function SignaturesPopover({
  steps,
  note = null,
}: {
  steps: Step[];
  // A line under the steps (e.g. when the request was forwarded), or null.
  note?: string | null;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const cleared = steps.filter(
    (s) => s.state === "done" || s.state === "skipped",
  ).length;
  const allDone = steps.length > 0 && cleared === steps.length;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        aria-expanded={open}
        aria-label={`Signatures: ${cleared} of ${steps.length} done`}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          allDone
            ? "bg-green-50 text-green-700 hover:bg-green-100"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M3 17c3-3 5-9 7-9s-1 9 1 9 3-4 4-4 1 3 3 3 2-1 3-1" />
          <path d="M3 21h18" />
        </svg>
        Signatures {cleared}/{steps.length}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-20 w-80 pt-2"
          role="dialog"
          aria-label="Signatures"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPinned(false);
              setHover(false);
            }
          }}
        >
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Signatures
            </p>
            <TaskProgressSummary tasks={steps} />
            {note && (
              <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                {note}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
