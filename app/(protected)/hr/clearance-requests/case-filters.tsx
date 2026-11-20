"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

const DELAY_MS = 300;

// Status + search for the Clearance Requests list, applied live (no Filter button). The page
// still reads them from ?status= and ?q= (a search in the URL is fine; errors never go there).
export function CaseFilters({
  statuses,
  initialStatus,
  initialQuery,
}: {
  statuses: readonly string[];
  initialStatus: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function apply(nextStatus: string, nextQuery: string) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    const search = params.toString();
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(status, value), DELAY_MS);
  }

  function changeStatus(value: string) {
    setStatus(value);
    apply(value, query);
  }

  function clear() {
    setStatus("");
    setQuery("");
    apply("", "");
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
        Status
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
        Search
        <input
          type="search"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="Case number, employee name or code"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      {isPending && <span className="py-2 text-xs text-slate-400">Searching…</span>}
      {(status || query) && (
        <button
          type="button"
          onClick={clear}
          className="py-2 text-sm text-slate-500 hover:text-slate-700"
        >
          Clear
        </button>
      )}
    </div>
  );
}
