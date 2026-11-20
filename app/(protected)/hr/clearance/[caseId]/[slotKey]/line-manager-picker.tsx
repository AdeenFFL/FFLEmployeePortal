"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchLineManagers, setLineManager } from "./actions";
import { LIVE_SEARCH_MIN, useLiveSearch } from "../../use-live-search";

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
  suggestion = null,
}: {
  caseId: string;
  // Name of the chosen line manager, or null when none is chosen.
  managerName: string | null;
  // Formatted date of the manager's confirmation, or null when not confirmed yet.
  confirmedOn: string | null;
  canChange: boolean;
  // Why the manager can no longer be changed (e.g. the HR details are saved), or null.
  lockedNote?: string | null;
  // The reporting manager from the employee's onboarding request. personId is null when that
  // person is no longer an active employee (then it is shown as a note, not offered).
  suggestion?: { personId: string | null; name: string; detail: string | null } | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Searches as you type (no Search button).
  const { results, error: searchError, searching, tooShort } = useLiveSearch(query, searchLineManagers);

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
          {suggestion && !managerName && (
            suggestion.personId ? (
              <div className="flex max-w-md items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-blue-700">From the onboarding request</p>
                  <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                  {suggestion.detail && <p className="text-xs text-slate-500">{suggestion.detail}</p>}
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => choose(suggestion.personId)}
                  className={smallButton}
                >
                  Choose
                </button>
              </div>
            ) : (
              <p className="max-w-md text-xs text-slate-500">
                The onboarding request names {suggestion.name}, who is no longer an active
                employee. Search for the current line manager.
              </p>
            )
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              managerName ? "Type a name or employee code to change" : "Type a name or employee code"
            }
            aria-label="Search line manager"
            className={`${inputClass} max-w-md`}
          />

          {tooShort && (
            <p className="text-xs text-slate-400">Type at least {LIVE_SEARCH_MIN} letters.</p>
          )}
          {searching && <p className="text-xs text-slate-400">Searching…</p>}
          {searchError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{searchError}</p>
          )}
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
