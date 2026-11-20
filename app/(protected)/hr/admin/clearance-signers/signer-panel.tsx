"use client";

import { useState, useTransition } from "react";
import { XIcon } from "@/components/icons";
import {
  addSigner,
  removeSigner,
  makePrimarySigner,
  searchSignerCandidates,
  type ActionResult,
  type SignerCandidate,
} from "./actions";
import { LIVE_SEARCH_MIN, useLiveSearch } from "../../clearance/use-live-search";

export type CellSigner = {
  id: string;
  person_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  is_primary: boolean;
  warnings: string[];
};

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// Opened from local state, not a URL param: the search text never goes into the URL, and the
// panel stays open (with fresh props) while revalidatePath refreshes the page after each change.
export function SignerCellPanel({
  slotKey,
  slotLabel,
  unitId,
  unitName,
  signers,
}: {
  slotKey: string;
  slotLabel: string;
  unitId: string;
  unitName: string;
  signers: CellSigner[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  // Searches as you type (no Search button).
  const { results, error: searchError, searching, tooShort } = useLiveSearch<SignerCandidate>(
    query,
    searchSignerCandidates,
  );

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
        else onSuccess?.();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    setQuery("");
  }

  const signerPersonIds = new Set(signers.map((s) => s.person_id));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        Manage
      </button>

      {open && (
        <div className="fixed inset-0 z-20">
          <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto rounded-l-xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{slotLabel}</h2>
                <p className="text-sm text-slate-500">{unitName}</p>
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

            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Signers
            </h3>
            {signers.length === 0 ? (
              <p className="mb-6 text-sm text-red-600">No signer yet.</p>
            ) : (
              <ul className="mb-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {signers.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {s.full_name}
                        {s.is_primary && (
                          <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Primary
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[s.employee_code, s.designation].filter(Boolean).join(" · ")}
                      </p>
                      {s.warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-700">
                          {w}
                        </p>
                      ))}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {!s.is_primary && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => makePrimarySigner(s.id))}
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Make primary
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => removeSigner(s.id))}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Add signer
            </h3>
            <div className="mb-3 flex flex-col gap-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name or employee code"
                aria-label="Search signer"
                className={inputClass}
              />
              {tooShort && (
                <p className="text-xs text-slate-400">Type at least {LIVE_SEARCH_MIN} letters.</p>
              )}
              {searching && <p className="text-xs text-slate-400">Searching…</p>}
            </div>
            {searchError && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{searchError}</p>
            )}

            {results && results.length === 0 && (
              <p className="text-sm text-slate-400">No active employee matches.</p>
            )}
            {results && results.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {results.map((p) => (
                  <li key={p.person_id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{p.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {[p.employee_code, p.designation].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-xs text-slate-400">
                        {[p.site_name, p.department_name].filter(Boolean).join(" · ") ||
                          "No site or department set"}
                      </p>
                    </div>
                    {signerPersonIds.has(p.person_id) ? (
                      <span className="shrink-0 text-xs text-slate-400">Already a signer</span>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () => addSigner(slotKey, unitId, p.person_id),
                            () => setQuery(""),
                          )
                        }
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
