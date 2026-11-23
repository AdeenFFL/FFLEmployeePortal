"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignClearanceAsset,
  assignClearanceLine,
  searchItStaff,
} from "./actions";
import { LIVE_SEARCH_MIN, useLiveSearch } from "../../use-live-search";
import { UserIcon } from "@/components/icons";

const smallButton =
  "rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

// The compact Assign button on a line or asset row: round, icon only.
const assignButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

// "Muhammad Arslan" -> "MA"; one word -> its first two letters.
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export type LineAssignee = {
  personId: string;
  name: string;
  doneByThem: boolean;
};

// What is handed out: one checklist line, or the return of one asset.
type AssignTarget =
  { kind: "line"; lineId: string } | { kind: "asset"; assignmentId: string };

// Under one line (or asset) of the IT part: who it is handed to, and (for the lead) a live search
// to hand it to an IT staff member or take it back. The assignee is notified in the portal and by
// email.
export function LineAssign({
  caseId,
  target,
  assignee,
  disabled,
  label,
  compact = false,
}: {
  caseId: string;
  target: AssignTarget;
  assignee: LineAssignee | null;
  disabled: boolean;
  // What is handed out (the line or the asset), shown under the popup's title.
  label?: string;
  // On the same row as the line (slot-form): no grey panel and no "Not assigned" sentence.
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    results,
    error: searchError,
    searching,
    tooShort,
  } = useLiveSearch(query, searchItStaff);
  const title = assignee ? "Reassign to IT staff" : "Assign to IT staff";

  function close() {
    setOpen(false);
    setQuery("");
    setError(null);
  }

  function assign(personId: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result =
          target.kind === "line"
            ? await assignClearanceLine(caseId, target.lineId, personId)
            : await assignClearanceAsset(caseId, target.assignmentId, personId);
        if (result.error) {
          setError(result.error);
          return;
        }
        close();
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-1"
          : "flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2"
      }
    >
      {compact ? (
        // Icon-only: a person icon, or the assignee's initials once given (name in the tooltip).
        <button
          type="button"
          className={
            assignee
              ? `relative inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold disabled:cursor-not-allowed ${
                  assignee.doneByThem
                    ? "bg-green-100 text-green-800"
                    : "bg-blue-100 text-blue-800"
                } ${disabled ? "" : "hover:ring-2 hover:ring-blue-300"}`
              : assignButton
          }
          disabled={isPending || (disabled && !assignee)}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          aria-label={
            assignee ? `Assigned to ${assignee.name}` : "Assign to IT staff"
          }
          title={
            assignee
              ? `Assigned to ${assignee.name}${assignee.doneByThem ? " (answered by them)" : ""}`
              : "Assign to IT staff"
          }
        >
          {assignee ? (
            initials(assignee.name)
          ) : (
            <UserIcon className="h-4 w-4" />
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {assignee ? (
            <span className="text-slate-700">
              Assigned to <span className="font-medium">{assignee.name}</span>
              {assignee.doneByThem && (
                <span className="text-green-700"> · answered by them</span>
              )}
            </span>
          ) : (
            <span className="text-slate-500">
              {target.kind === "line"
                ? "Not assigned: answer it yourself or assign it."
                : "Not assigned: return it yourself or assign it."}
            </span>
          )}
          {!disabled && (
            <button
              type="button"
              className={smallButton}
              disabled={isPending}
              onClick={() => setOpen(true)}
            >
              {assignee ? "Reassign" : "Assign to IT staff"}
            </button>
          )}
          {!disabled && assignee && (
            <button
              type="button"
              className={smallButton}
              disabled={isPending}
              onClick={() => assign(null)}
            >
              Take back
            </button>
          )}
        </div>
      )}

      {open && (
        // A popup (same look as the portal's other popups), not a panel opening inside the line.
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">
                  {title}
                </h2>
                {label && (
                  <p className="truncate text-sm text-slate-500">{label}</p>
                )}
                {compact && assignee && (
                  // The compact row has no Take back button: it lives here.
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                    Now with{" "}
                    <span className="font-medium">{assignee.name}</span>
                    <button
                      type="button"
                      className={smallButton}
                      disabled={isPending}
                      onClick={() => assign(null)}
                    >
                      Take back
                    </button>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                className="text-xl leading-none text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type an IT staff name or employee code"
              aria-label="Search IT staff"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {tooShort && (
              <p className="text-xs text-slate-400">
                Type at least {LIVE_SEARCH_MIN} letters.
              </p>
            )}
            {searching && <p className="text-xs text-slate-400">Searching…</p>}
            {searchError && (
              <p className="text-xs text-red-700">{searchError}</p>
            )}
            {results && results.length === 0 && (
              <p className="text-xs text-slate-400">
                No active IT staff member matches.
              </p>
            )}
            {results && results.length > 0 && (
              <ul className="min-h-0 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {results.map((p) => (
                  <li
                    key={p.person_id}
                    className="flex items-start justify-between gap-3 p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900">{p.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {[p.employee_code, p.designation]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={smallButton}
                      disabled={isPending || p.person_id === assignee?.personId}
                      onClick={() => assign(p.person_id)}
                    >
                      {p.person_id === assignee?.personId
                        ? "Assigned"
                        : "Assign"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="text-xs text-red-700">{error}</p>}
          </div>
        </div>
      )}

      {!open && error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
