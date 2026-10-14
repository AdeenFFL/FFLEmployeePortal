import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import {
  FINISHED_STATUSES,
  KIND_TONE,
  LIFECYCLE_KINDS,
  LIFECYCLE_STATUSES,
  LIFECYCLE_STATUS_TONE,
} from "@/lib/it/onboarding";
import { formatDate } from "@/lib/it/tickets";
import type { ItLifecycleKind, ItLifecycleStatus } from "@/types/database";
import {
  cardClass,
  FormMessage,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../_components/ticket-ui";

type Filters = {
  kind?: string;
  status?: string;
  team?: string;
  q?: string;
  notice?: string;
  error?: string;
};

// SCR-04 — Onboarding / Offboarding queue (BRD §5.1, §5.2). Gated by it.onboarding.read.
export default async function OnboardingQueuePage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const status = filters.status ?? "active";
  const supabase = await createClient();

  let query = supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select(
      "id, request_number, kind, employee_name, employee_code, site_id, routing_team, due_date, status, it_executive_person_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "active") query = query.not("status", "in", `(${FINISHED_STATUSES.join(",")})`);
  else if (LIFECYCLE_STATUSES.includes(status as ItLifecycleStatus)) {
    query = query.eq("status", status as ItLifecycleStatus);
  }
  if (filters.kind && LIFECYCLE_KINDS.includes(filters.kind as ItLifecycleKind)) {
    query = query.eq("kind", filters.kind as ItLifecycleKind);
  }
  if (filters.team === "IT HQ Team" || filters.team === "IT Plant Site Team") {
    query = query.eq("routing_team", filters.team);
  }
  const q = (filters.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) {
    query = query.or(
      `request_number.ilike.%${q}%,employee_name.ilike.%${q}%,employee_code.ilike.%${q}%`,
    );
  }

  const [{ data: requests }, orgUnits, canCreate] = await Promise.all([
    query.then(checked),
    fetchOrgUnits(supabase),
    hasItPermission(supabase, "it.onboarding.create"),
  ]);
  const rows = requests ?? [];

  const [{ data: items }, names] = await Promise.all([
    rows.length > 0
      ? supabase
          .schema("it")
          .from("checklist_items")
          .select("request_id, status")
          .in(
            "request_id",
            rows.map((r) => r.id),
          )
      : Promise.resolve({ data: [] as { request_id: string; status: string }[] }),
    fetchPersonNames(
      supabase,
      rows.map((r) => r.it_executive_person_id),
    ),
  ]);

  const progress = new Map<string, { done: number; total: number }>();
  for (const item of items ?? []) {
    const p = progress.get(item.request_id) ?? { done: 0, total: 0 };
    p.total++;
    if (item.status === "Completed" || item.status === "Not Applicable") p.done++;
    progress.set(item.request_id, p);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="py-6">
      <PageHeader
        title="Onboarding & Offboarding"
        description="New joiners, leavers and equipment replacements — every IT step in one checklist."
        action={
          canCreate ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/it/onboarding/new?kind=Onboarding" className={primaryButtonClass}>
                New onboarding
              </Link>
              <Link href="/it/onboarding/new?kind=Offboarding" className={secondaryButtonClass}>
                New offboarding
              </Link>
              <Link href="/it/onboarding/new?kind=Replacement" className={secondaryButtonClass}>
                Replacement
              </Link>
            </div>
          ) : undefined
        }
      />
      <FormMessage error={filters.error} notice={filters.notice} />

      <form method="get" className={`${cardClass} mb-6 grid gap-3 p-4 md:grid-cols-5`}>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Number, name or employee code"
          aria-label="Search"
          className={`${inputClass} md:col-span-2`}
        />
        <select name="kind" defaultValue={filters.kind ?? ""} aria-label="Type" className={inputClass}>
          <option value="">All types</option>
          {LIFECYCLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className={inputClass}>
          <option value="active">All active</option>
          <option value="all">All statuses</option>
          {LIFECYCLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="team" defaultValue={filters.team ?? ""} aria-label="IT team" className={inputClass}>
          <option value="">Both IT teams</option>
          <option value="IT HQ Team">IT HQ Team</option>
          <option value="IT Plant Site Team">IT Plant Site Team</option>
        </select>
        <div className="flex gap-2 md:col-span-5">
          <button type="submit" className={primaryButtonClass}>
            Apply filters
          </button>
          <Link href="/it/onboarding" className={secondaryButtonClass}>
            Reset
          </Link>
        </div>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No requests match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">IT team</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Checklist</th>
                  <th className="px-4 py-3 font-medium">IT Executive</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const p = progress.get(r.id) ?? { done: 0, total: 0 };
                  const overdue =
                    r.due_date && r.due_date < today && !FINISHED_STATUSES.includes(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link
                          href={`/it/onboarding/${r.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {r.request_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill label={r.kind} tone={KIND_TONE[r.kind]} />
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {r.employee_name}
                        {r.employee_code && (
                          <span className="ml-1 text-xs text-slate-400">({r.employee_code})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {(r.site_id && orgUnits.nameById.get(r.site_id)) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.routing_team}</td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 ${
                          overdue ? "font-medium text-red-600" : "text-slate-600"
                        }`}
                      >
                        {formatDate(r.due_date)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.done}/{p.total}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.it_executive_person_id ? (
                          (names.get(r.it_executive_person_id) ?? "—")
                        ) : (
                          <span className="text-slate-400">Not picked up</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill label={r.status} tone={LIFECYCLE_STATUS_TONE[r.status]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
