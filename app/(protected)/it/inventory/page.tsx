import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { fetchOrgUnits } from "@/lib/it/ticket-data";
import { ASSET_STATUSES, ASSET_STATUS_TONES, formatDate, type AssetStatus } from "./asset-status";

// Hard cap until the register gets pagination — well above any one filtered view today.
const MAX_ROWS = 500;

const selectClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500";

// The search term goes into a PostgREST `or=(...)` filter string, where commas, parentheses
// and wildcards are syntax — strip them so a search can't change the shape of the filter.
function sanitizeSearch(value: string) {
  return value.replace(/[,()*%\\]/g, " ").trim();
}

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
  if (search) query = query.or(`asset_tag.ilike.*${search}*,serial_number.ilike.*${search}*`);
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
    { data: canRequestReplacement },
  ] = await Promise.all([
    query.order("updated_at", { ascending: false }).limit(MAX_ROWS),
    supabase.schema("it").from("asset_types").select("id, name").order("name"),
    supabase.from("companies").select("id, name").order("name"),
    fetchOrgUnits(supabase),
    supabase.rpc("has_permission", { p_permission_key: "it.assets.create" }),
    supabase.rpc("has_permission", { p_permission_key: "it.onboarding.create" }),
  ]);

  const hasFilters = Boolean(search || params.type || status || params.site || params.company);

  return (
    <div className="py-6">
      <PageHeader
        title="Asset Register"
        description="Every IT asset across all companies and sites."
        action={
          canCreate || canRequestReplacement ? (
            <div className="flex flex-wrap gap-2">
              {canRequestReplacement && (
                <Link
                  href="/it/onboarding/new?kind=Replacement"
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Request replacement
                </Link>
              )}
              {canCreate && (
                <Link
                  href="/it/inventory/new"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  + Add Asset
                </Link>
              )}
            </div>
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

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-700">Search</label>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Asset tag or serial number"
            className={`${selectClass} w-full`}
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
        <select name="status" defaultValue={status ?? ""} className={selectClass} aria-label="Status">
          <option value="">All statuses</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {sites.length > 0 && (
          <select name="site" defaultValue={params.site ?? ""} className={selectClass} aria-label="Site">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          name="company"
          defaultValue={params.company ?? ""}
          className={selectClass}
          aria-label="Company"
        >
          <option value="">All companies</option>
          {(companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Apply
        </button>
        {hasFilters && (
          <Link
            href="/it/inventory"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Asset Tag</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Serial Number</th>
              <th className="px-4 py-3 font-medium">Site</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(assets ?? []).map((asset) => (
              <tr key={asset.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs font-medium">
                  <Link href={`/it/inventory/${asset.id}`} className="text-blue-600 hover:underline">
                    {asset.asset_tag}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-900">{asset.asset_name}</td>
                <td className="px-4 py-3 text-slate-600">{asset.asset_types?.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{asset.serial_number}</td>
                <td className="px-4 py-3 text-slate-600">
                  {(asset.site_id && siteNameById.get(asset.site_id)) ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill label={asset.status} tone={ASSET_STATUS_TONES[asset.status]} />
                </td>
                <td className="px-4 py-3 text-slate-500">{formatDate(asset.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(assets ?? []).length === 0 && (
          <p className="p-6 text-center text-sm text-slate-400">
            {hasFilters ? "No assets match your search." : "No assets yet."}
          </p>
        )}
      </div>

      {(assets ?? []).length === MAX_ROWS && (
        <p className="mt-3 text-xs text-slate-500">
          Showing the {MAX_ROWS} most recently updated assets. Narrow the search to see others.
        </p>
      )}
    </div>
  );
}
