import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { FINISHED_STATUSES, KIND_TONE, LIFECYCLE_STATUSES, LIFECYCLE_STATUS_TONE } from "@/lib/it/onboarding";
import { formatDate } from "@/lib/it/tickets";
import type { ItLifecycleKind, ItLifecycleStatus } from "@/types/database";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "../../it/_components/ticket-ui";

// HR's own onboarding / offboarding list. Each row opens HR's read-only view (/hr/onboarding/[id]):
// the request, how far IT has got, and the activity. IT's checklist and actions stay on
// /it/onboarding. Rows come from the same table under the same RLS.
const KINDS: ItLifecycleKind[] = ["Onboarding", "Offboarding"];

export default async function HrOnboardingListPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const status = filters.status ?? "active";
  const supabase = await createClient();

  let query = supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select("id, request_number, kind, employee_name, employee_code, site_id, joining_date, last_working_date, due_date, status, created_at")
    .in("kind", KINDS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === "active") query = query.not("status", "in", `(${FINISHED_STATUSES.join(",")})`);
  else if (LIFECYCLE_STATUSES.includes(status as ItLifecycleStatus)) query = query.eq("status", status as ItLifecycleStatus);
  if (filters.kind && KINDS.includes(filters.kind as ItLifecycleKind)) query = query.eq("kind", filters.kind as ItLifecycleKind);
  const q = (filters.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) query = query.or(`request_number.ilike.%${q}%,employee_name.ilike.%${q}%,employee_code.ilike.%${q}%`);

  const [{ data: requests }, orgUnits] = await Promise.all([query.then(checked), fetchOrgUnits(supabase)]);
  const rows = requests ?? [];

  const { data: items } = rows.length
    ? await supabase.schema("it").from("checklist_items").select("request_id, status").in("request_id", rows.map((r) => r.id))
    : { data: [] as { request_id: string; status: string }[] };
  const progress = new Map<string, { done: number; total: number }>();
  for (const item of items ?? []) {
    const p = progress.get(item.request_id) ?? { done: 0, total: 0 };
    p.total++;
    if (item.status === "Completed" || item.status === "Not Applicable") p.done++;
    progress.set(item.request_id, p);
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Onboarding & Offboarding"
        description="Joiners and leavers you have raised. Open one to see its details, how far IT has got, and its activity."
        action={
          <Link href="/it/onboarding/new?kind=Onboarding" className={primaryButtonClass}>
            + New onboarding
          </Link>
        }
      />

      <form method="get" className={`${cardClass} mb-6 grid gap-3 p-4 md:grid-cols-4`}>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Number, name or employee code"
          aria-label="Search"
          className={`${inputClass} md:col-span-2`}
        />
        <select name="kind" defaultValue={filters.kind ?? ""} aria-label="Type" className={inputClass}>
          <option value="">All types</option>
          {KINDS.map((k) => (
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
        <div className="flex gap-2 md:col-span-4">
          <button type="submit" className={primaryButtonClass}>
            Apply filters
          </button>
          <Link href="/hr/onboarding" className={secondaryButtonClass}>
            Reset
          </Link>
        </div>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No requests match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Joining / last day</th>
                  <th className="px-4 py-3 font-medium">IT progress</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const p = progress.get(r.id) ?? { done: 0, total: 0 };
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`/hr/onboarding/${r.id}`} className="font-medium text-blue-700 hover:underline">
                          {r.request_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill label={r.kind} tone={KIND_TONE[r.kind]} />
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {r.employee_name}
                        {r.employee_code && <span className="ml-1 text-xs text-slate-400">({r.employee_code})</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{(r.site_id && orgUnits.nameById.get(r.site_id)) ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDate(r.kind === "Onboarding" ? r.joining_date : r.last_working_date)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.done}/{p.total} tasks
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
