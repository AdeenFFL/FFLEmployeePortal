"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchLineManagers, setLineManager, type ManagerCandidate } from "./actions";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const smallButton =
  "rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

// The HR signer chooses the employee's line manager. That person then confirms "Complete data
// received" from their own My Requests page, which fills the page-one line by itself. The search
// text stays in local state (never in the URL); errors stay inline.
export function LineManagerPicker({
  caseId,
  managerName,
  confirmedOn,
  canChange,
  lockedNote = null,
}: {
  caseId: string;
  // Name of the chosen line manager, or null when none is chosen.
  managerName: string | null;
  // Formatted date of the manager's confirmation, or null when not confirmed yet.
  confirmedOn: string | null;
  canChange: boolean;
  // Why the manager can no longer be changed (e.g. the HR details are saved), or null.
  lockedNote?: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ManagerCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await searchLineManagers(query);
        if (result.error) {
          setError(result.error);
          setResults(null);
        } else {
          setResults(result.people);
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function choose(personId: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setLineManager(caseId, personId);
        if (result.error) {
          setError(result.error);
        } else {
          // Re-read the page so the new manager and the locked line show; clear the search.
          setQuery("");
          setResults(null);
          router.refresh();
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        The line manager confirms “Complete data received” in the portal, and that line on page
        one fills in by itself. Choosing someone also sets “Direct reporting manager” above.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-900">
          {managerName ? (
            <>
              Line manager: <span className="font-medium">{managerName}</span>
            </>
          ) : (
            "No line manager chosen. You answer “Complete data received” yourself."
          )}
        </p>
        {managerName && canChange && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => choose(null)}
            className={smallButton}
          >
            Clear
          </button>
        )}
      </div>

      {lockedNote && <p className="text-xs text-slate-500">{lockedNote}</p>}

      {managerName &&
        (confirmedOn ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Confirmed “Complete data received” on {confirmedOn}. It can no longer be changed.
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Waiting for {managerName} to confirm from their My Requests page.
          </p>
        ))}

      {canChange && (
        <div className="flex flex-col gap-3">
          <form onSubmit={handleSearch} className="flex max-w-md gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or employee code"
              aria-label="Search line manager"
              className={`${inputClass} flex-1`}
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {managerName ? "Change" : "Search"}
            </button>
          </form>

          {results && results.length === 0 && (
            <p className="text-sm text-slate-400">No active employee matches.</p>
          )}
          {results && results.length > 0 && (
            <ul className="max-w-md divide-y divide-slate-100 rounded-lg border border-slate-200">
              {results.map((p) => (
                <li key={p.person_id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{p.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {[p.employee_code, p.designation].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => choose(p.person_id)}
                    className={smallButton}
                  >
                    Choose
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
