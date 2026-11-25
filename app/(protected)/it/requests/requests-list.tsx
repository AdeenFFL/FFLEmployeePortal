"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusPill } from "@/components/status-pill";

type Tone = "positive" | "neutral" | "warning" | "negative" | "info";
export type RequestKind = "Ticket" | "Onboarding" | "Offboarding" | "Replacement";

export type RequestRow = {
  key: string;
  kind: RequestKind;
  number: string;
  title: string;
  siteId: string | null;
  siteName: string | null;
  status: string;
  statusTone: Tone;
  active: boolean;
  createdAt: string;
  href: string;
};

const KIND_STYLE: Record<RequestKind, { dot: string; label: string }> = {
  Ticket: { dot: "bg-blue-500", label: "Tickets" },
  Onboarding: { dot: "bg-emerald-500", label: "Onboarding" },
  Offboarding: { dot: "bg-rose-500", label: "Offboarding" },
  Replacement: { dot: "bg-violet-500", label: "Replacement" },
};

// Fixed time zone so the server render and the browser print the same text.
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

const norm = (s: string | null) => (s ?? "").toLowerCase();

// The Requests queue: type tabs with counts, search as you type, Active / All, site. All in
// the browser, no Apply button. Each row opens its own page.
export function RequestsList({
  rows,
  kinds,
  sites,
  limitReached,
}: {
  rows: RequestRow[];
  kinds: RequestKind[];
  sites: { id: string; name: string }[];
  limitReached: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<RequestKind | "">("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [siteId, setSiteId] = useState("");

  const terms = norm(query).split(/\s+/).filter(Boolean);
  const base = rows.filter(
    (r) =>
      (!activeOnly || r.active) &&
      (!siteId || r.siteId === siteId) &&
      terms.every((t) => `${norm(r.number)} ${norm(r.title)} ${norm(r.siteName)}`.includes(t)),
  );
  const shown = kind ? base.filter((r) => r.kind === kind) : base;
  const countOf = (k: RequestKind) => base.filter((r) => r.kind === k).length;
  const filtered = Boolean(query || kind || !activeOnly || siteId);

  const tabClass = (on: boolean) =>
    `-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
      on ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
    }`;
  const countClass = (on: boolean) =>
    `rounded-full px-2 py-0.5 text-xs ${on ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`;

  return (
    <div>
      {/* Type tabs */}
      <div className="mb-5 flex gap-6 overflow-x-auto border-b border-slate-200">
        <button type="button" onClick={() => setKind("")} className={tabClass(kind === "")}>
          All <span className={countClass(kind === "")}>{base.length}</span>
        </button>
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={tabClass(kind === k)}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${KIND_STYLE[k].dot}`} />
            {KIND_STYLE[k].label} <span className={countClass(kind === k)}>{countOf(k)}</span>
          </button>
        ))}
      </div>

      {/* Search + filters, one row */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by number, subject, employee name or code…"
            aria-label="Search requests"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          aria-label="Filter by site"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Active or all" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-1">
          {[
            { on: true, label: "Active" },
            { on: false, label: "All" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={activeOnly === o.on}
              onClick={() => setActiveOnly(o.on)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeOnly === o.on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-900">{filtered ? "Nothing matches" : "No requests yet"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {filtered ? "Try another search, type or site, or show All." : "New tickets and HR requests show up here."}
            </p>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setKind("");
                  setActiveOnly(true);
                  setSiteId("");
                }}
                className="mt-3 text-sm font-medium text-blue-700 hover:underline"
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs font-medium text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Subject / employee</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => router.push(r.href)}
                    className="cursor-pointer transition-colors hover:bg-slate-50/80"
                  >
                    <td className="whitespace-nowrap px-5 py-3">
                      <Link
                        href={r.href}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                      >
                        {r.number}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${KIND_STYLE[r.kind].dot}`} />
                        {r.kind}
                      </p>
                    </td>
                    <td className="max-w-sm truncate px-4 py-3 text-slate-700">{r.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{r.siteName ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{shortDate(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <StatusPill label={r.status} tone={r.statusTone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > 0 && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
            {shown.length} request{shown.length === 1 ? "" : "s"}
            {limitReached && " · only the latest 200 of each kind are loaded"}
          </p>
        )}
      </div>
    </div>
  );
}
