"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

const DELAY_MS = 300;

const TAB_LABEL: Record<string, string> = {
  "": "All",
  Submitted: "To forward",
  "In Clearance": "In clearance",
};

// Status + search for the Clearance Requests list, applied live (no Filter button). The page
// still reads them from ?status= and ?q= (a search in the URL is fine; errors never go there).
export function CaseFilters({
  statuses,
  counts,
  initialStatus,
  initialQuery,
}: {
  statuses: readonly string[];
  // How many requests have each status (null when the count failed).
  counts: Record<string, number | null>;
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
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
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
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {/* Status as tabs, each with its count. */}
      <div
        className="flex w-full flex-wrap gap-1 border-b border-slate-200"
        role="tablist"
      >
        {["", ...statuses].map((st) => {
          const active = status === st;
          const count = st ? counts[st] : null;
          return (
            <button
              key={st || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => changeStatus(st)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {TAB_LABEL[st] ?? st}
              {typeof count === "number" && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    st === "Submitted" && count > 0
                      ? "bg-red-500 text-white"
                      : active
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
        <span className="sr-only">Search</span>
        <input
          type="search"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="Case number, employee name or code"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      {isPending && (
        <span className="py-2 text-xs text-slate-400">Searching…</span>
      )}
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
