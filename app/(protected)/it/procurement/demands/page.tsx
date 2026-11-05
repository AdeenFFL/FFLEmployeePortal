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
  todayIso,
} from "@/lib/it/procurement";
import type { ItDemandCategory, ItDemandStatus } from "@/types/database";
import { cardClass, FormMessage, inputClass, primaryButtonClass, secondaryButtonClass } from "../../_components/ticket-ui";
import { EmptyState, StatTile, SubTabs } from "../_components/ui";

const PAGE_SIZE = 100;

// Statuses where procurement has the next move (Needs action view).
const ACTION_STATUSES: ItDemandStatus[] = [
  "Open",
  "Categorized",
  "Approved",
  "Partially Approved",
  "Rejected",
  "Received",
];

function nextStep(
  d: { id: string; status: ItDemandStatus; follow_up_on: string | null },
  today: string,
  gatePassPending: Set<string>,
) {
  switch (d.status) {
    case "Open":
      return "Categorise";
    case "Categorized":
      return "Send for approval";
    case "Approved":
    case "Partially Approved":
      return "Assign vendor";
    case "Rejected":
      return "Revise or cancel";
    case "Received":
      return "Log invoice";
  }
  if (d.follow_up_on && d.follow_up_on <= today && (d.status === "Assigned to Vendor" || d.status === "Partially Received")) {
    return "Follow up delivery";
  }
  if (gatePassPending.has(d.id)) return "Add gate pass";
  return null;
}

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

  const [canRead, canReadAll, canCreate, canUpdate] = await Promise.all([
    hasItPermission(supabase, "it.demands.read"),
    hasItPermission(supabase, "it.demands.read_all"),
    hasItPermission(supabase, "it.demands.create"),
    hasItPermission(supabase, "it.demands.update"),
  ]);
  const isStaff = canRead || canReadAll;
  const view: "mine" | "queue" | "action" =
    !isStaff || params.view === "mine" ? "mine" : params.view === "action" && canUpdate ? "action" : "queue";
  const today = todayIso();

  // Deliveries with neither a gate pass number nor a gate pass picture (javaria_it_0012), across
  // everything the viewer can see — feeds the badge and the Needs action view.
  const { data: noNumber } = await supabase
    .schema("it")
    .from("receiving_records")
    .select("id, demand_id")
    .is("gate_pass_no", null)
    .gt("received_quantity", 0)
    .limit(500);
  const { data: gatePics } = (noNumber ?? []).length
    ? await supabase
        .schema("it")
        .from("documents")
        .select("entity_id")
        .eq("doc_type", "Gate Pass")
        .in(
          "entity_id",
          (noNumber ?? []).map((r) => r.id),
        )
    : { data: [] };
  const withPicture = new Set((gatePics ?? []).map((d) => d.entity_id));
  const gatePassPending = new Set(
    (noNumber ?? []).filter((r) => !withPicture.has(r.id)).map((r) => r.demand_id),
  );
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
      "id, demand_number, product_id, quantity, estimated_unit_price, status, demand_category, site_id, department_id, requested_by_person_id, created_at, follow_up_on",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (view === "mine") query = query.eq("requested_by_person_id", personId ?? "");
  if (view === "action") {
    // Waiting on procurement: categorise, send / revise, assign vendor, overdue delivery, gate pass.
    const pending = [...gatePassPending];
    query = query.or(
      [
        `status.in.(${ACTION_STATUSES.map((s) => `"${s}"`).join(",")})`,
        `and(status.in.("Assigned to Vendor","Partially Received"),follow_up_on.lte.${today})`,
        ...(pending.length ? [`and(id.in.(${pending.join(",")}),status.not.in.("Closed","Cancelled"))`] : []),
      ].join(","),
    );
  } else if (status === "active") query = query.in("status", ACTIVE_DEMAND_STATUSES);
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

  const base = `/it/procurement/demands?view=${view}`;
  const kpis = [
    { label: "Waiting to be sent", value: openRes.count ?? 0, tone: "slate" as const, href: `${base}&status=Categorized` },
    { label: "Awaiting approval", value: approvalRes.count ?? 0, tone: "amber" as const, href: `${base}&status=Pending%20Approval` },
    { label: "Awaiting delivery", value: deliveryRes.count ?? 0, tone: "blue" as const, href: `${base}&status=Assigned%20to%20Vendor` },
  ];
  const views = [
    ...(canUpdate ? [{ key: "action", label: "Needs action" }] : []),
    { key: "queue", label: "All demands" },
    { key: "mine", label: "My demands" },
  ].map((v) => ({ ...v, href: `/it/procurement/demands?view=${v.key}` }));
  const filtered = Boolean(q || params.site || category || (params.status && params.status !== "active"));

  return (
    <div className="py-6">
      <PageHeader
        title={view === "mine" ? "My Demands" : view === "action" ? "Needs Action" : "Demand Queue"}
        description={
          view === "mine"
            ? "Purchase demands you've raised."
            : view === "action"
              ? "Demands waiting on procurement: categorise, send for approval, revise, assign a vendor, follow up a delivery or add a gate pass."
            : canReadAll
              ? "Purchase demands from every site."
              : "Purchase demands for the sites whose IT team you're on."
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      {isStaff && <SubTabs items={views} active={view} />}

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <StatTile key={k.label} {...k} />
        ))}
      </dl>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search DMD-000123"
          aria-label="Search demand number"
          className={`${inputClass} w-48 bg-white`}
        />
        {view !== "action" && (
          <select name="status" defaultValue={status} aria-label="Status" className={`${inputClass} w-auto bg-white`}>
            <option value="active">Active</option>
            <option value="all">All statuses</option>
            {DEMAND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select name="category" defaultValue={category} aria-label="Category" className={`${inputClass} w-auto bg-white`}>
          <option value="">All categories</option>
          <option value="none">Not categorised</option>
          {DEMAND_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {view !== "mine" && (
          <select name="site" defaultValue={params.site ?? ""} aria-label="Site" className={`${inputClass} w-auto bg-white`}>
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
        {filtered && (
          <Link href={`/it/procurement/demands?view=${view}`} className={secondaryButtonClass}>
            Clear
          </Link>
        )}
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <EmptyState
            title={
              view === "action"
                ? "All caught up"
                : filtered
                  ? "No demands match these filters"
                  : view === "mine"
                    ? "You haven't raised any demands yet"
                    : "No active demands"
            }
            text={
              view === "action"
                ? "Nothing is waiting on procurement right now."
                : filtered
                  ? "Try clearing a filter or searching another number."
                  : "Demands appear here as soon as they are raised."
            }
            action={canCreate && !filtered && view !== "action" ? { href: "/it/procurement/demands/new", label: "Raise a demand" } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Demand</th>
                  <th className="px-6 py-3 font-medium">Product</th>
                  <th className="px-6 py-3 text-right font-medium">Qty</th>
                  <th className="px-6 py-3 text-right font-medium">Est. total</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  {view !== "mine" && <th className="px-6 py-3 font-medium">Requested by</th>}
                  <th className="px-6 py-3 font-medium">Site</th>
                  <th className="px-6 py-3 font-medium">Raised</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  {view === "action" && <th className="px-6 py-3 font-medium">Next step</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const product = productById.get(d.product_id);
                  const total = d.estimated_unit_price === null ? null : Number(d.estimated_unit_price) * d.quantity;
                  return (
                    <tr key={d.id} className="group relative hover:bg-blue-50/40">
                      <td className="whitespace-nowrap px-6 py-3">
                        {/* The whole row opens the demand (stretched link). */}
                        <Link
                          href={`/it/procurement/demands/${d.id}`}
                          className="font-medium text-blue-700 after:absolute after:inset-0 group-hover:underline"
                        >
                          {d.demand_number}
                        </Link>
                      </td>
                      <td className="px-6 py-3 font-medium text-slate-800">{product?.product_name ?? "—"}</td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-700">
                        {d.quantity} {product?.unit ?? ""}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-700">
                        {formatMoney(total)}
                      </td>
                      <td className="px-6 py-3 text-slate-600">{demandCategoryLabel(d.demand_category)}</td>
                      {view !== "mine" && (
                        <td className="px-6 py-3 text-slate-600">{nameById.get(d.requested_by_person_id) ?? "—"}</td>
                      )}
                      <td className="px-6 py-3 text-slate-600">{orgUnits.nameById.get(d.site_id) ?? "—"}</td>
                      <td className="whitespace-nowrap px-6 py-3 text-slate-600">{formatDate(d.created_at)}</td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-1">
                          <StatusPill label={d.status} tone={DEMAND_STATUS_TONE[d.status]} />
                          {gatePassPending.has(d.id) && <StatusPill label="Gate pass pending" tone="warning" />}
                        </div>
                      </td>
                      {view === "action" && (
                        <td className="whitespace-nowrap px-6 py-3">
                          <Link
                            href={`/it/procurement/demands/${d.id}`}
                            className="text-sm font-medium text-blue-700 hover:underline"
                          >
                            {nextStep(d, today, gatePassPending) ?? "Open"} →
                          </Link>
                        </td>
                      )}
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
