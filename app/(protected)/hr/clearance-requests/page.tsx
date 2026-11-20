import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { StartClearancePanel } from "./start-panel";
import { CaseFilters } from "./case-filters";
import {
  CASE_STATUSES,
  STATUS_TONE,
  addDays,
  daysLeftText,
  formatDay,
  karachiToday,
  type SlotInfo,
} from "./clearance-view";

const PAGE_LIMIT = 500;

type Filters = { status?: string; q?: string };

// HRBP inbox. Cases, signoffs and slots are readable with hr.clearance.read_all (RLS); site and
// department names and the signers come from the security-definer lookups in talha_hr_0004, since
// HR can't read org_units / persons directly.
export default async function ClearanceRequestsPage({ searchParams }: { searchParams: Promise<Filters> }) {
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

  const [casesResult, unitsResult, slotsResult, signersResult, { data: canForward }] =
    await Promise.all([
      casesQuery,
      hr.rpc("clearance_list_units"),
      hr
        .from("clearance_slots")
        .select("slot_key, label, scope")
        .eq("is_active", true)
        .order("sort_order"),
      hr.rpc("clearance_list_signers"),
      supabase.rpc("has_permission", { p_permission_key: "hr.clearance.forward" }),
    ]);

  const loadError = casesResult.error ?? unitsResult.error ?? slotsResult.error ?? signersResult.error;

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
      <PageHeader
        title="Clearance Requests"
        description="Employee clearance requests: forward them to the signers and follow their progress."
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

      <CaseFilters statuses={CASE_STATUSES} initialStatus={status ?? ""} initialQuery={filters.q ?? ""} />

      {loadError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          No requests match these filters.
        </p>
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
                  const site = c.site_id ? (unitName.get(c.site_id) ?? "(inactive site)") : "—";
                  const dept = c.department_id
                    ? (unitName.get(c.department_id) ?? "(inactive department)")
                    : "—";
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/hr/clearance-requests/${c.id}`} className="text-blue-600 hover:text-blue-700">
                          {c.case_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-900">{c.employee_name}</p>
                        {c.employee_code && <p className="text-xs text-slate-500">{c.employee_code}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.designation ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {site} · {dept}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-900">{formatDay(c.last_working_date)}</p>
                        <p className="text-xs text-slate-500">{daysLeftText(c.last_working_date, today)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.clearance_signoffs[0]?.count ?? 0} of{" "}
                        {slots.length - (c.clearance_skips[0]?.count ?? 0)}
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
              Showing the newest {PAGE_LIMIT} requests. Use the filters to find older ones.
            </p>
          )}
        </>
      )}
    </div>
  );
}
