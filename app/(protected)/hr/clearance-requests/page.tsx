import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { StartClearancePanel } from "./start-panel";
import { CaseFilters } from "./case-filters";
import { EmptyState } from "../clearance/empty-state";
import {
  CASE_STATUSES,
  STATUS_TONE,
  addDays,
  daysLeftText,
  formatDay,
  karachiToday,
  lastDayBadgeClass,
  type SlotInfo,
} from "./clearance-view";

const PAGE_LIMIT = 500;

// "3/5 signed" with a thin bar (green once every part not skipped is signed).
function SignedBar({ signed, total }: { signed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((signed / total) * 100)) : 0;
  return (
    <div className="flex w-28 flex-col gap-1">
      <span className="text-xs">
        {signed}/{total} signed
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <span
          className={`block h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

type Filters = { status?: string; q?: string };

// HRBP inbox. Cases, signoffs and slots are readable with hr.clearance.read_all (RLS); site and
// department names and the signers come from the security-definer lookups in talha_hr_0004, since
// HR can't read org_units / persons directly.
export default async function ClearanceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const status = CASE_STATUSES.find((s) => s === filters.status);
  // Same cleanup as it/requests: these characters would break the PostgREST or() filter.
  const q = (filters.q ?? "").replace(/[,()*%]/g, " ").trim();

  const supabase = await createClient();
  const hr = supabase.schema("hr");

  let casesQuery = hr
    .from("clearance_cases")
    .select(
      "id, case_number, employee_name, employee_code, designation, site_id, department_id, last_working_date, status, raised_via, created_at, clearance_signoffs(count), clearance_skips(count)",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT + 1);
  if (status) casesQuery = casesQuery.eq("status", status);
  if (q) {
    casesQuery = casesQuery.or(
      `case_number.ilike.%${q}%,employee_name.ilike.%${q}%,employee_code.ilike.%${q}%`,
    );
  }

  // Counts for the status tabs (head-only).
  const countOf = (st: (typeof CASE_STATUSES)[number]) =>
    hr
      .from("clearance_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", st);
  const statusCountsPromise = Promise.all(
    CASE_STATUSES.map((st) => countOf(st)),
  ).then((rs): Record<string, number | null> =>
    Object.fromEntries(
      CASE_STATUSES.map((st, i) => [
        st,
        rs[i].error ? null : (rs[i].count ?? 0),
      ]),
    ),
  );

  const [
    casesResult,
    unitsResult,
    slotsResult,
    signersResult,
    { data: canForward },
    statusCounts,
  ] = await Promise.all([
    casesQuery,
    hr.rpc("clearance_list_units"),
    hr
      .from("clearance_slots")
      .select("slot_key, label, scope")
      .eq("is_active", true)
      .order("sort_order"),
    hr.rpc("clearance_list_signers"),
    supabase.rpc("has_permission", {
      p_permission_key: "hr.clearance.forward",
    }),
    statusCountsPromise,
  ]);

  const loadError =
    casesResult.error ??
    unitsResult.error ??
    slotsResult.error ??
    signersResult.error;

  const rows = (casesResult.data ?? []).slice(0, PAGE_LIMIT);
  const hasMore = (casesResult.data ?? []).length > PAGE_LIMIT;
  const unitName = new Map((unitsResult.data ?? []).map((u) => [u.id, u.name]));
  const slots: SlotInfo[] = slotsResult.data ?? [];
  const signerScopes = (signersResult.data ?? []).map((g) => ({
    slot_key: g.slot_key,
    site_id: g.site_id,
    department_id: g.department_id,
  }));
  const today = karachiToday();

  return (
    <div className="py-6">
      {/* Round back button (words in the tooltip) beside the title. */}
      <div className="flex items-start gap-3">
        <Link
          href="/hr/clearance-home"
          title="Back to Clearance"
          aria-label="Back to Clearance"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <PageHeader
            title="Clearance Requests"
            action={
              canForward ? (
                <StartClearancePanel
                  slots={slots}
                  signers={signerScopes}
                  minDate={addDays(today, -30)}
                  maxDate={addDays(today, 365)}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      <CaseFilters
        statuses={CASE_STATUSES}
        counts={statusCounts}
        initialStatus={status ?? ""}
        initialQuery={filters.q ?? ""}
      />

      {loadError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError.message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon="🔍" text="No requests match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Case no.</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Site · Department</th>
                  <th className="px-4 py-3">Last working date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Signatures</th>
                  <th className="px-4 py-3">Raised by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const site = c.site_id
                    ? (unitName.get(c.site_id) ?? "(inactive site)")
                    : "—";
                  const dept = c.department_id
                    ? (unitName.get(c.department_id) ?? "(inactive department)")
                    : "—";
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/hr/clearance-requests/${c.id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {c.case_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-900">{c.employee_name}</p>
                        {c.employee_code && (
                          <p className="text-xs text-slate-500">
                            {c.employee_code}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.designation ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {site} · {dept}
                      </td>
                      <td className="px-4 py-3">
                        {/* Coloured by how close the last day is (as on the request page). */}
                        <span
                          className={`inline-flex flex-col rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ${lastDayBadgeClass(c.last_working_date, today, c.status)}`}
                        >
                          <span>{formatDay(c.last_working_date)}</span>
                          <span className="font-normal">
                            {daysLeftText(c.last_working_date, today)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          label={c.status}
                          tone={STATUS_TONE[c.status]}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <SignedBar
                          signed={c.clearance_signoffs[0]?.count ?? 0}
                          total={Math.max(
                            slots.length - (c.clearance_skips[0]?.count ?? 0),
                            0,
                          )}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.raised_via === "self" ? "Employee" : "HR"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <p className="mt-3 text-xs text-slate-500">
              Showing the newest {PAGE_LIMIT} requests. Use the filters to find
              older ones.
            </p>
          )}
        </>
      )}
    </div>
  );
}
