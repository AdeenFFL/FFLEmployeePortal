"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "@/components/icons";
import { searchEmployees, startClearance, type EmployeeCandidate } from "./actions";
import { readinessProblems, type SignerScope, type SlotInfo } from "./clearance-view";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// Opened from local state, not a URL param: the employee search text never goes into the URL.
export function StartClearancePanel({
  slots,
  signers,
  minDate,
  maxDate,
}: {
  slots: SlotInfo[];
  signers: SignerScope[];
  minDate: string;
  maxDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeCandidate[] | null>(null);
  const [picked, setPicked] = useState<EmployeeCandidate | null>(null);
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
    setQuery("");
    setResults(null);
    setPicked(null);
    setLastWorkingDate("");
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPicked(null);
    startTransition(async () => {
      try {
        const result = await searchEmployees(query);
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

  function handleStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await startClearance(picked.person_id, lastWorkingDate);
        if (result.error || !result.caseId) {
          setError(result.error ?? "Something went wrong. Please try again.");
        } else {
          router.push(`/hr/resignations/${result.caseId}`);
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  const readiness = picked
    ? readinessProblems(picked.site_id, picked.department_id, slots, signers)
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Start clearance for an employee
      </button>

      {open && (
        <div className="fixed inset-0 z-20">
          <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto rounded-l-xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Start clearance</h2>
                <p className="text-sm text-slate-500">
                  For an employee who is leaving. It starts as Submitted: skip any part that is not needed, then forward it to the signers.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <form onSubmit={handleSearch} className="mb-3 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or employee code"
                className={`${inputClass} flex-1`}
              />
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Search
              </button>
            </form>

            {results && results.length === 0 && (
              <p className="text-sm text-slate-400">No active or recently left employee matches.</p>
            )}
            {results && results.length > 0 && (
              <ul className="mb-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {results.map((p) => (
                  <li
                    key={p.person_id}
                    className={`flex items-start justify-between gap-3 p-3 ${
                      picked?.person_id === p.person_id ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{p.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {[p.employee_code, p.designation].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-xs text-slate-400">
                        {[p.site_name, p.department_name].filter(Boolean).join(" · ") ||
                          "No site or department set"}
                      </p>
                      {p.person_status !== "Active" && (
                        <p className="text-xs text-amber-700">
                          {p.person_status} (recently left)
                        </p>
                      )}
                    </div>
                    {p.has_open_case ? (
                      <span className="shrink-0 text-xs text-slate-400">
                        Already has an open request
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setError(null);
                          setPicked(p);
                        }}
                        className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {picked?.person_id === p.person_id ? "Selected" : "Select"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {picked && readiness && (
              <form onSubmit={handleStart} className="flex flex-col gap-4 border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-700">
                  Starting clearance for <span className="font-medium">{picked.full_name}</span>
                </p>

                {!readiness.ready && (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <p className="font-medium">You can start it, but it cannot be forwarded yet:</p>
                    <ul className="list-disc pl-5">
                      {readiness.messages.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    {(readiness.missingSite || readiness.missingDepartment) && (
                      <p className="mt-1">Ask Admin to set it in Admin &gt; Users before forwarding.</p>
                    )}
                    {readiness.slotsWithoutSigner.length > 0 && (
                      <p className="mt-1">Set the missing signers on the Clearance Signers page, or skip those parts on the request after starting.</p>
                    )}
                  </div>
                )}

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Last working date</span>
                  <input
                    type="date"
                    required
                    min={minDate}
                    max={maxDate}
                    value={lastWorkingDate}
                    onChange={(e) => setLastWorkingDate(e.target.value)}
                    className={`${inputClass} w-fit`}
                  />
                  <span className="text-xs text-slate-400">
                    Up to 30 days in the past (for someone who already left), or up to a year ahead.
                  </span>
                </label>

                <div>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending ? "Starting…" : "Start clearance"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
