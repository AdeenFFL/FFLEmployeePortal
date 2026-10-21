import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits, hasItPermission } from "@/lib/it/ticket-data";
import { formatDate } from "@/lib/it/tickets";
import {
  ACTIVE_DEMAND_STATUSES,
  DEMAND_CATEGORIES,
  DEMAND_STATUS_TONE,
  DEMAND_STATUSES,
  demandCategoryLabel,
  formatMoney,
} from "@/lib/it/procurement";
import type { ItDemandCategory, ItDemandStatus } from "@/types/database";
import { cardClass, FormMessage, inputClass, primaryButtonClass } from "../../_components/ticket-ui";

const PAGE_SIZE = 100;

// PRC-03 Demand queue. RLS decides which rows come back: own demands always, the sites whose IT
// team the viewer is on with it.demands.read, every site with it.demands.read_all
// (javaria_it_0010_demands.sql). Route gate is module:it so requesters reach their own demands.
export default async function DemandsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    status?: string;
    category?: string;
    site?: string;
    q?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [canRead, canReadAll, canCreate] = await Promise.all([
    hasItPermission(supabase, "it.demands.read"),
    hasItPermission(supabase, "it.demands.read_all"),
    hasItPermission(supabase, "it.demands.create"),
  ]);
  const isStaff = canRead || canReadAll;
  const view = !isStaff || params.view === "mine" ? "mine" : "queue";
  const status = (DEMAND_STATUSES as string[]).includes(params.status ?? "")
    ? (params.status as ItDemandStatus)
    : params.status === "all"
      ? "all"
      : "active";
  const category = DEMAND_CATEGORIES.some((c) => c.value === params.category)
    ? (params.category as ItDemandCategory)
    : params.category === "none"
      ? "none"
      : "";

  let query = supabase
    .schema("it")
    .from("demands")
    .select(
      "id, demand_number, product_id, quantity, estimated_unit_price, status, demand_category, site_id, department_id, requested_by_person_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (view === "mine") query = query.eq("requested_by_person_id", personId ?? "");
  if (status === "active") query = query.in("status", ACTIVE_DEMAND_STATUSES);
  else if (status !== "all") query = query.eq("status", status);
  if (category === "none") query = query.is("demand_category", null);
  else if (category) query = query.eq("demand_category", category);
  if (params.site) query = query.eq("site_id", params.site);
  const q = (params.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) query = query.ilike("demand_number", `%${q}%`);

  // KPI strip counts the same visible set, ignoring the filters.
  const countFor = (statuses: ItDemandStatus[]) => {
    let c = supabase.schema("it").from("demands").select("id", { count: "exact", head: true }).in("status", statuses);
    if (view === "mine") c = c.eq("requested_by_person_id", personId ?? "");
    return c;
  };

  const [demandsRes, orgUnits, productsRes, openRes, approvalRes, deliveryRes] = await Promise.all([
    query,
    fetchOrgUnits(supabase),
    supabase.schema("it").from("products").select("id, product_name, unit"),
    countFor(["Open", "Categorized"]),
    countFor(["Pending Approval"]),
    countFor(["Approved", "Partially Approved", "Assigned to Vendor", "Partially Received"]),
  ]);
  const rows = checked(demandsRes).data ?? [];
  const productById = new Map((productsRes.data ?? []).map((p) => [p.id, p]));

  const requesterIds = [...new Set(rows.map((r) => r.requested_by_person_id))];
  const { data: people } = requesterIds.length
    ? await supabase.schema("it").rpc("demand_person_names", { p_person_ids: requesterIds })
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.person_id, p.full_name]));

  const kpis = [
    { label: "To categorise / route", value: openRes.count ?? 0 },
    { label: "Awaiting approval", value: approvalRes.count ?? 0 },
    { label: "Awaiting delivery", value: deliveryRes.count ?? 0 },
  ];
  const tab = (key: "queue" | "mine", label: string) => (
    <Link
      href={`/it/procurement/demands?view=${key}`}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        view === key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="py-6">
      <PageHeader
        title={view === "mine" ? "My Demands" : "Demand Queue"}
        description={
          view === "mine"
            ? "Purchase demands you've raised."
            : canReadAll
              ? "Purchase demands from every site."
              : "Purchase demands for the sites whose IT team you're on."
        }
        action={
          canCreate ? (
            <Link href="/it/procurement/demands/new" className={primaryButtonClass}>
              Raise Demand
            </Link>
          ) : undefined
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      {isStaff && (
        <div className="mb-4 flex gap-2">
          {tab("queue", "Queue")}
          {tab("mine", "My demands")}
        </div>
      )}

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className={`${cardClass} px-5 py-4`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{k.value}</dd>
          </div>
        ))}
      </dl>

      <form method="get" className={`${cardClass} mb-6 flex flex-wrap items-center gap-3 p-4`}>
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="DMD-000123"
          aria-label="Search demand number"
          className={`${inputClass} w-40`}
        />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputClass} w-auto`}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          {DEMAND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={category} aria-label="Category" className={`${inputClass} w-auto`}>
          <option value="">All categories</option>
          <option value="none">Not categorised</option>
          {DEMAND_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {view === "queue" && (
          <select name="site" defaultValue={params.site ?? ""} aria-label="Site" className={`${inputClass} w-auto`}>
            <option value="">All my sites</option>
            {orgUnits.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={primaryButtonClass}>
          Filter
        </button>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {view === "mine" ? "You haven't raised any demands matching this filter." : "No demands match."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Demand</th>
                  <th className="px-6 py-3 font-medium">Product</th>
                  <th className="px-6 py-3 text-right font-medium">Qty</th>
                  <th className="px-6 py-3 text-right font-medium">Est. total</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  {view === "queue" && <th className="px-6 py-3 font-medium">Requested by</th>}
                  <th className="px-6 py-3 font-medium">Site</th>
                  <th className="px-6 py-3 font-medium">Raised</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const product = productById.get(d.product_id);
                  const total = d.estimated_unit_price === null ? null : Number(d.estimated_unit_price) * d.quantity;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-6 py-3">
                        <Link
                          href={`/it/procurement/demands/${d.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {d.demand_number}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-slate-800">{product?.product_name ?? "—"}</td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-700">
                        {d.quantity} {product?.unit ?? ""}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-700">
                        {formatMoney(total)}
                      </td>
                      <td className="px-6 py-3 text-slate-600">{demandCategoryLabel(d.demand_category)}</td>
                      {view === "queue" && (
                        <td className="px-6 py-3 text-slate-600">{nameById.get(d.requested_by_person_id) ?? "—"}</td>
                      )}
                      <td className="px-6 py-3 text-slate-600">{orgUnits.nameById.get(d.site_id) ?? "—"}</td>
                      <td className="whitespace-nowrap px-6 py-3 text-slate-600">{formatDate(d.created_at)}</td>
                      <td className="px-6 py-3">
                        <StatusPill label={d.status} tone={DEMAND_STATUS_TONE[d.status]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === PAGE_SIZE && (
          <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
            Showing the latest {PAGE_SIZE}. Narrow the filters to find older demands.
          </p>
        )}
      </div>
    </div>
  );
}
