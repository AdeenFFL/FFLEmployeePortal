import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { fetchAssetPersonNames, fetchOrgUnits } from "@/lib/it/ticket-data";
import { ProductIcon, productKind } from "../procurement/_components/product-icon";
import { ASSET_STATUSES, ASSET_STATUS_TONES, formatDate, type AssetStatus } from "./asset-status";

// Hard cap until the register gets pagination — well above any one filtered view today.
const MAX_ROWS = 500;

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

// Status tiles across the top double as the status filter, in lifecycle order.
const STATUS_TILES: { status: AssetStatus; label: string; dot: string }[] = [
  { status: "Unassigned", label: "In stock", dot: "bg-blue-500" },
  { status: "In Use", label: "In use", dot: "bg-emerald-500" },
  { status: "In Repair", label: "In repair", dot: "bg-amber-500" },
  { status: "Retired", label: "Retired", dot: "bg-slate-400" },
  { status: "Disposed", label: "Disposed", dot: "bg-slate-300" },
  { status: "Lost", label: "Lost", dot: "bg-red-500" },
];

// The search term goes into a PostgREST `or=(...)` filter string, where commas, parentheses
// and wildcards are syntax — strip them so a search can't change the shape of the filter.
function sanitizeSearch(value: string) {
  return value.replace(/[,()*%\\]/g, " ").trim();
}

// INV-02 Asset Register: every IT asset, who has it, and — from procurement (javaria_it_0021) —
// delivered fixed-asset items still waiting to be registered.
export default async function AssetRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    status?: string;
    site?: string;
    company?: string;
    created?: string;
    deleted?: string;
  }>;
}) {
  const params = await searchParams;
  const search = sanitizeSearch(params.q ?? "");
  const status = ASSET_STATUSES.includes(params.status as AssetStatus)
    ? (params.status as AssetStatus)
    : undefined;
  const supabase = await createClient();

  // RLS ("assets readable by asset viewers") already limits this to it.assets.read holders.
  // Deleted assets are soft-deleted (deleted_at set) and never shown here.
  let query = supabase
    .schema("it")
    .from("assets")
    .select(
      "id, asset_tag, asset_name, serial_number, site_id, company_id, status, updated_at, asset_types(name)",
    )
    .is("deleted_at", null);
  if (search) {
    query = query.or(`asset_tag.ilike.*${search}*,serial_number.ilike.*${search}*,asset_name.ilike.*${search}*`);
  }
  if (params.type) query = query.eq("asset_type_id", params.type);
  if (status) query = query.eq("status", status);
  if (params.site) query = query.eq("site_id", params.site);
  if (params.company) query = query.eq("company_id", params.company);

  // Site/company names come from public tables: cross-schema embeds aren't typeable in
  // supabase-js (see types/database.ts), so they're fetched separately. Sites go through
  // it.list_org_units() because public.org_units is admin-readable only.
  const [
    { data: assets },
    { data: assetTypes },
    { data: companies },
    { sites, nameById: siteNameById },
    { data: canCreate },
    { data: statusRows },
  ] = await Promise.all([
    query.order("updated_at", { ascending: false }).limit(MAX_ROWS),
    supabase.schema("it").from("asset_types").select("id, name, classification").order("name"),
    supabase.from("companies").select("id, name").order("name"),
    fetchOrgUnits(supabase),
    supabase.rpc("has_permission", { p_permission_key: "it.assets.create" }),
    supabase.schema("it").from("assets").select("status, receiving_id").is("deleted_at", null),
  ]);
  const rows = assets ?? [];
  const statusCount = new Map<string, number>();
  for (const r of statusRows ?? []) statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1);
  const total = statusRows?.length ?? 0;

  // Who holds each listed In Use / In Repair asset (open assignment rows).
  const heldIds = rows.filter((a) => a.status === "In Use" || a.status === "In Repair").map((a) => a.id);
  const { data: openAssignments } = heldIds.length
    ? await supabase
        .schema("it")
        .from("asset_assignments")
        .select("asset_id, person_id")
        .in("asset_id", heldIds)
        .is("return_date", null)
    : { data: [] as { asset_id: string; person_id: string }[] };
  const holderNames = await fetchAssetPersonNames(supabase, (openAssignments ?? []).map((a) => a.person_id));
  const holderOf = new Map((openAssignments ?? []).map((a) => [a.asset_id, holderNames.get(a.person_id) ?? "—"]));

  // Receiving → assets: accepted fixed-asset deliveries not yet fully registered. RLS on
  // receiving_records may hide them from inventory-only staff — then the banner simply doesn't show.
  const waiting = canCreate ? await waitingDeliveries(supabase, assetTypes ?? [], statusRows ?? []) : [];
  const waitingItems = waiting.reduce((n, w) => n + w.remaining, 0);

  const hasFilters = Boolean(search || params.type || status || params.site || params.company);
  const filterHref = (s?: AssetStatus) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.type) sp.set("type", params.type);
    if (params.site) sp.set("site", params.site);
    if (params.company) sp.set("company", params.company);
    if (s && s !== status) sp.set("status", s);
    const qs = sp.toString();
    return qs ? `/it/inventory?${qs}` : "/it/inventory";
  };

  return (
    <div className="py-6">
      <PageHeader
        title="Asset Register"
        description="Every IT asset, where it is in its life, and who has it."
        action={
          canCreate ? (
            <Link
              href="/it/inventory/new"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add asset
            </Link>
          ) : undefined
        }
      />

      {params.created && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Asset {params.created} registered.
        </p>
      )}
      {params.deleted && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Asset {params.deleted} deleted.
        </p>
      )}

      {waitingItems > 0 && (
        <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-4">
          <p className="text-sm font-medium text-blue-900">
            {waitingItems} delivered item{waitingItems === 1 ? "" : "s"} waiting to be registered
          </p>
          <p className="mt-0.5 text-xs text-blue-800/80">
            Received through procurement — open the demand and enter each item&apos;s tag and serial.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {waiting.map((w) => (
              <li key={w.receivingId}>
                <Link
                  href={`/it/procurement/demands/${w.demandId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-800 hover:border-blue-400"
                >
                  {w.demandNumber} · {w.productName}
                  <span className="rounded-full bg-blue-100 px-1.5 text-[11px]">{w.remaining}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_TILES.map((t) => {
          const active = status === t.status;
          return (
            <Link
              key={t.status}
              href={filterHref(t.status)}
              aria-current={active ? "true" : undefined}
              className={`rounded-xl border bg-white px-4 py-3 transition ${
                active ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                {t.label}
              </span>
              <span className="mt-1 block text-xl font-semibold tabular-nums text-slate-900">
                {statusCount.get(t.status) ?? 0}
              </span>
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative min-w-[16rem] flex-1">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Tag, serial number or name"
            aria-label="Search assets"
            className={`${selectClass} w-full pl-9`}
          />
        </div>
        <select name="type" defaultValue={params.type ?? ""} className={selectClass} aria-label="Type">
          <option value="">All types</option>
          {(assetTypes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {sites.length > 1 && (
          <select name="site" defaultValue={params.site ?? ""} className={selectClass} aria-label="Site">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {(companies ?? []).length > 1 && (
          <select name="company" defaultValue={params.company ?? ""} className={selectClass} aria-label="Company">
            <option value="">All companies</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
        {hasFilters && (
          <Link href="/it/inventory" className="text-sm font-medium text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-4 py-3 font-medium">Serial number</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">With</th>
              <th className="px-4 py-3 font-medium">Site</th>
              <th className="px-5 py-3 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((asset) => (
              <tr key={asset.id} className="relative transition hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <ProductIcon
                        kind={productKind({ name: asset.asset_name, category: asset.asset_types?.name ?? null })}
                        className="h-5 w-5"
                      />
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/it/inventory/${asset.id}`}
                        className="font-mono text-xs font-semibold text-slate-900 after:absolute after:inset-0 hover:text-blue-700"
                      >
                        {asset.asset_tag}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        {asset.asset_name}
                        {asset.asset_types?.name && ` · ${asset.asset_types.name}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{asset.serial_number}</td>
                <td className="px-4 py-3">
                  <StatusPill label={asset.status} tone={ASSET_STATUS_TONES[asset.status]} />
                </td>
                <td className="px-4 py-3 text-slate-700">{holderOf.get(asset.id) ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 text-slate-600">{(asset.site_id && siteNameById.get(asset.site_id)) ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-slate-500">
                  {formatDate(asset.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            {hasFilters ? "No assets match your search." : "No assets yet."}
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {rows.length === MAX_ROWS
          ? `Showing the ${MAX_ROWS} most recently updated assets. Narrow the search to see others.`
          : `${rows.length} of ${total} asset${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Deliveries of fixed-asset products with accepted items that have no asset row yet.
async function waitingDeliveries(
  supabase: Supabase,
  assetTypes: { id: string; classification: string }[],
  assetRows: { receiving_id: string | null }[],
) {
  const fixedTypes = new Set(assetTypes.filter((t) => t.classification === "Fixed").map((t) => t.id));
  const { data: receipts, error } = await supabase
    .schema("it")
    .from("receiving_records")
    .select("id, accepted_quantity, demand_id, demands(demand_number, product_id)")
    .is("deleted_at", null)
    .gt("accepted_quantity", 0);
  if (error || !receipts?.length) return [];

  const { data: products } = await supabase.schema("it").from("products").select("id, product_name, asset_type_id");
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const registered = new Map<string, number>();
  for (const a of assetRows) if (a.receiving_id) registered.set(a.receiving_id, (registered.get(a.receiving_id) ?? 0) + 1);

  return receipts.flatMap((r) => {
    const demand = (Array.isArray(r.demands) ? r.demands[0] : r.demands) as
      | { demand_number: string; product_id: string }
      | null
      | undefined;
    const product = demand ? productById.get(demand.product_id) : undefined;
    if (!demand || !product?.asset_type_id || !fixedTypes.has(product.asset_type_id)) return [];
    const remaining = r.accepted_quantity - (registered.get(r.id) ?? 0);
    return remaining > 0
      ? [{ receivingId: r.id, demandId: r.demand_id, demandNumber: demand.demand_number, productName: product.product_name, remaining }]
      : [];
  });
}
