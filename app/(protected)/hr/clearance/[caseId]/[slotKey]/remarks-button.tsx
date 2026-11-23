"use client";

import { useState } from "react";
import { ChatIcon } from "@/components/icons";

// Round icon-only button; the name shows as a tooltip.
export const iconButton =
  "relative inline-flex h-8 w-8 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60";

// One checklist line's remarks behind a small icon button, so each line stays one row. The button
// has a blue dot when a remark is written, and turns red while a "No" still has none; it opens a popup with the text (to edit, or only to read
// when onChange is not given). `open` / `onOpenChange` let the form open it by itself (an answer
// of "No" needs a remark); without them it opens on click only.
export function RemarksButton({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  open: openProp,
  onOpenChange,
}: {
  value: string;
  onChange?: (value: string) => void;
  // The line, shown under the popup's title.
  label: string;
  required?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const hasText = value.trim().length > 0;
  const readOnly = !onChange;
  const missing = required && !hasText;

  // Nothing to show on a read-only line without a remark.
  if (readOnly && !hasText) return null;

  return (
    <>
      <button
        type="button"
        className={`${iconButton} ${missing ? "bg-red-50 text-red-600 ring-1 ring-red-300 hover:bg-red-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Remarks: ${label}`}
        title={hasText ? `Remarks: ${value}` : required ? "Remarks (required)" : "Add remarks"}
      >
        <ChatIcon className="h-4 w-4" />
        {hasText && (
          <span
            className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Remarks"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="relative flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">Remarks</h2>
                <p className="text-sm text-slate-500">{label}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xl leading-none text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {readOnly ? (
              <p className="whitespace-pre-wrap text-sm text-slate-800">{value}</p>
            ) : (
              <>
                <textarea
                  autoFocus
                  rows={3}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  maxLength={500}
                  placeholder={required ? "Remarks (required)" : "Remarks (optional)"}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {required && !hasText && (
                  <p className="text-xs text-slate-500">This answer needs a short remark.</p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// A small coloured tag on the right of a line: its answer, or where the process is waiting.
export function LineTag({ tone, children, title }: { tone: "done" | "no" | "waiting" | "plain"; children: React.ReactNode; title?: string }) {
  const toneClass = {
    done: "bg-green-50 text-green-700 ring-green-200",
    no: "bg-red-50 text-red-700 ring-red-200",
    waiting: "bg-amber-50 text-amber-800 ring-amber-200",
    plain: "bg-slate-50 text-slate-700 ring-slate-200",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClass}`}>
      {children}
    </span>
  );
}
