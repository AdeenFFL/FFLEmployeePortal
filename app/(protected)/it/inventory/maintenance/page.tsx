import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatCost, formatDate } from "../asset-status";

// Hard cap until the log gets pagination, same as the Asset Register.
const MAX_ROWS = 500;

const REPAIR_STATUSES = ["Open", "Completed"] as const;
type RepairStatus = (typeof REPAIR_STATUSES)[number];

const selectClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500";

// Same rule as the Asset Register: strip characters that are syntax in a PostgREST filter or
// LIKE pattern, so a search can't change the shape of the query.
function sanitizeSearch(value: string) {
  return value.replace(/[,()*%\\]/g, " ").trim();
}

// Only accept real YYYY-MM-DD values from the URL; anything else is ignored.
function parseDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

// INV-06 — repairs across all assets, newest first. Gated by it.assets.read (the /it/inventory
// prefix in route-permissions.ts); RLS on it.asset_maintenance and it.assets enforces the same.
// Read-only: repairs are started and closed from the asset detail page.
export default async function RepairLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const search = sanitizeSearch(params.q ?? "");
  const status = REPAIR_STATUSES.includes(params.status as RepairStatus)
    ? (params.status as RepairStatus)
    : undefined;
  const from = parseDate(params.from);
  const to = parseDate(params.to);
  const rangeInvalid = Boolean(from && to && from > to);
  const hasFilters = Boolean(search || status || from || to);

  const supabase = await createClient();

  // !inner so the asset-tag search filters the repairs themselves, not just the embedded asset.
  let query = supabase
    .schema("it")
    .from("asset_maintenance")
    .select(
      "id, asset_id, issue_type, description, service_date, returned_date, status, resolution, cost, assets!inner(asset_tag, asset_name, deleted_at)",
      { count: "exact" },
    );
  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("assets.asset_tag", `%${search}%`);
  if (from) query = query.gte("service_date", from);
  if (to) query = query.lte("service_date", to);

  const { data, count, error } = rangeInvalid
    ? { data: null, count: null, error: null }
    : await query
        .order("service_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
  const repairs = data ?? [];

  return (
    <div className="py-6">
      <PageHeader
        title="Repair Log"
        description="Repairs across all IT assets. To send an asset for repair, open it from the Asset Register."
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Asset tag</span>
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="e.g. FFL-LAP"
            className={selectClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Status</span>
          <select name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">All</option>
            {REPAIR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Sent from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className={selectClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Sent to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className={selectClass} />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Filter
        </button>
        {hasFilters && (
          <Link href="/it/inventory/maintenance" className="py-2 text-sm text-blue-600 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      {rangeInvalid ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The &ldquo;Sent from&rdquo; date ({formatDate(from ?? null)}) is after the &ldquo;Sent
          to&rdquo; date ({formatDate(to ?? null)}). Please choose a from date on or before the to
          date.
        </p>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load the repair log: {error.message}
        </p>
      ) : repairs.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          {hasFilters ? "No repairs match these filters." : "No repairs recorded yet."}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Returned</th>
                  <th className="px-4 py-3">Resolution</th>
                  <th className="px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {repairs.map((r) => {
                  const asset = r.assets;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        {asset && !asset.deleted_at ? (
                          <Link href={`/it/inventory/${r.asset_id}`} className="hover:underline">
                            <span className="font-mono text-xs text-slate-700">{asset.asset_tag}</span>
                            <span className="block text-slate-900">{asset.asset_name}</span>
                          </Link>
                        ) : (
                          // Deleted assets keep their repair history but have no detail page.
                          <>
                            <span className="font-mono text-xs text-slate-500">
                              {asset?.asset_tag ?? "—"}
                            </span>{" "}
                            <span className="text-xs text-slate-400">(deleted)</span>
                            <span className="block text-slate-500">{asset?.asset_name}</span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        <span className="font-medium">{r.issue_type}</span>
                        {r.description && (
                          <span className="block text-xs text-slate-500">{r.description}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {formatDate(r.service_date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {r.status === "Open" ? (
                          <StatusPill label="Open" tone="warning" />
                        ) : (
                          formatDate(r.returned_date)
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.resolution ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {r.status === "Open" ? "—" : formatCost(r.cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(count ?? 0) > repairs.length && (
            <p className="mt-3 text-xs text-slate-500">
              Showing the {repairs.length} most recent of {count} repairs. Narrow the filters to see
              others.
            </p>
          )}
        </>
      )}
    </div>
  );
}
