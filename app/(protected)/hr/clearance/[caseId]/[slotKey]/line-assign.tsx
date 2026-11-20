"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignClearanceAsset, assignClearanceLine, searchItStaff } from "./actions";
import { LIVE_SEARCH_MIN, useLiveSearch } from "../../use-live-search";

const smallButton =
  "rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

export type LineAssignee = { personId: string; name: string; doneByThem: boolean };

// What is handed out: one checklist line, or the return of one asset.
type AssignTarget = { kind: "line"; lineId: string } | { kind: "asset"; assignmentId: string };

// Under one line (or asset) of the IT part: who it is handed to, and (for the lead) a live search
// to hand it to an IT staff member or take it back. The assignee is notified in the portal and by
// email.
export function LineAssign({
  caseId,
  target,
  assignee,
  disabled,
}: {
  caseId: string;
  target: AssignTarget;
  assignee: LineAssignee | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { results, error: searchError, searching, tooShort } = useLiveSearch(query, searchItStaff);

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
        setOpen(false);
        setQuery("");
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {assignee ? (
          <span className="text-slate-700">
            Assigned to <span className="font-medium">{assignee.name}</span>
            {assignee.doneByThem && <span className="text-green-700"> · answered by them</span>}
          </span>
        ) : (
          <span className="text-slate-500">
            {target.kind === "line"
              ? "Not assigned: answer it yourself or assign it."
              : "Not assigned: return it yourself or assign it."}
          </span>
        )}
        {!disabled && !open && (
          <button type="button" className={smallButton} disabled={isPending} onClick={() => setOpen(true)}>
            {assignee ? "Reassign" : "Assign to IT staff"}
          </button>
        )}
        {!disabled && assignee && !open && (
          <button type="button" className={smallButton} disabled={isPending} onClick={() => assign(null)}>
            Take back
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type an IT staff name or employee code"
              aria-label="Search IT staff"
              className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              className={smallButton}
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
            >
              Cancel
            </button>
          </div>
          {tooShort && (
            <p className="text-xs text-slate-400">Type at least {LIVE_SEARCH_MIN} letters.</p>
          )}
          {searching && <p className="text-xs text-slate-400">Searching…</p>}
          {searchError && <p className="text-xs text-red-700">{searchError}</p>}
          {results && results.length === 0 && (
            <p className="text-xs text-slate-400">No active IT staff member matches.</p>
          )}
          {results && results.length > 0 && (
            <ul className="max-w-sm divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {results.map((p) => (
                <li key={p.person_id} className="flex items-start justify-between gap-3 p-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900">{p.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {[p.employee_code, p.designation].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={isPending || p.person_id === assignee?.personId}
                    onClick={() => assign(p.person_id)}
                  >
                    {p.person_id === assignee?.personId ? "Assigned" : "Assign"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
