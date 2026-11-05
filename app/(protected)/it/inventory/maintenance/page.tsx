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
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

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

  // Summary of what is listed: open repairs, days out, money spent, assets that keep coming back.
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  const daysOut = (r: (typeof repairs)[number]) =>
    Math.max(0, Math.round((new Date(r.returned_date ?? today).getTime() - new Date(r.service_date).getTime()) / DAY));
  const openCount = repairs.filter((r) => r.status === "Open").length;
  const totalCost = repairs.reduce((n, r) => n + (r.status === "Open" ? 0 : Number(r.cost ?? 0)), 0);
  const perAsset = new Map<string, number>();
  for (const r of repairs) perAsset.set(r.asset_id, (perAsset.get(r.asset_id) ?? 0) + 1);
  const repeatAssets = [...perAsset.values()].filter((n) => n > 1).length;
  const closed = repairs.filter((r) => r.status !== "Open");
  const avgDays = closed.length ? Math.round(closed.reduce((n, r) => n + daysOut(r), 0) / closed.length) : null;

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: params.q, status, from, to, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/it/inventory/maintenance?${qs}` : "/it/inventory/maintenance";
  };

  return (
    <div className="py-6">
      <PageHeader
        title="Repair Log"
        description="Every repair across IT assets. Repairs are started and closed on the asset's own page."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="In repair now" value={openCount} dot="bg-amber-500" href={href({ status: "Open" })} />
        <Tile label="Repair cost" value={formatCost(totalCost)} dot="bg-blue-500" />
        <Tile label="Average days out" value={avgDays ?? "—"} dot="bg-slate-400" />
        <Tile label="Repaired more than once" value={repeatAssets} dot="bg-red-500" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative min-w-[14rem] flex-1">
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
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Asset tag"
            aria-label="Asset tag"
            className={`${selectClass} w-full pl-9`}
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Sent</span>
          <input type="date" name="from" defaultValue={from ?? ""} aria-label="Sent from" className={selectClass} />
          <span>–</span>
          <input type="date" name="to" defaultValue={to ?? ""} aria-label="Sent to" className={selectClass} />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Status">
          {([undefined, "Open", "Completed"] as const).map((st) => (
            <Link
              key={st ?? "all"}
              href={href({ status: st })}
              aria-current={status === st ? "true" : undefined}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                status === st ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {st ?? "All"}
            </Link>
          ))}
        </div>
        {hasFilters && (
          <Link href="/it/inventory/maintenance" className="text-sm font-medium text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      {rangeInvalid ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The &ldquo;Sent from&rdquo; date ({formatDate(from ?? null)}) is after the &ldquo;to&rdquo; date (
          {formatDate(to ?? null)}).
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
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Asset</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Back</th>
                  <th className="px-4 py-3">Resolution</th>
                  <th className="px-5 py-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {repairs.map((r) => {
                  const asset = r.assets;
                  const live = asset && !asset.deleted_at;
                  const repeats = perAsset.get(r.asset_id) ?? 0;
                  return (
                    <tr key={r.id} className={`relative ${live ? "transition hover:bg-slate-50" : ""}`}>
                      <td className="px-5 py-3">
                        {live ? (
                          <Link
                            href={`/it/inventory/${r.asset_id}`}
                            className="font-mono text-xs font-semibold text-slate-900 after:absolute after:inset-0 hover:text-blue-700"
                          >
                            {asset.asset_tag}
                          </Link>
                        ) : (
                          // Deleted assets keep their repair history but have no detail page.
                          <span className="font-mono text-xs text-slate-400">
                            {asset?.asset_tag ?? "—"} <span className="font-sans">(deleted)</span>
                          </span>
                        )}
                        <span className={`block ${live ? "text-slate-700" : "text-slate-400"}`}>{asset?.asset_name}</span>
                        {repeats > 1 && (
                          <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            {repeats} repairs
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">{r.issue_type}</span>
                        {r.description && <span className="block text-xs text-slate-500">{r.description}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(r.service_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.status === "Open" ? (
                          <>
                            <StatusPill label="In repair" tone="warning" />
                            <span className="mt-1 block text-xs text-slate-500">{daysOut(r)} days so far</span>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-700">{formatDate(r.returned_date)}</span>
                            <span className="block text-xs text-slate-400">
                              {daysOut(r) === 0 ? "same day" : `${daysOut(r)} day${daysOut(r) === 1 ? "" : "s"}`}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.resolution ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-slate-900">
                        {r.status === "Open" ? <span className="text-slate-300">—</span> : formatCost(r.cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {(count ?? 0) > repairs.length
              ? `Showing the ${repairs.length} most recent of ${count} repairs. Narrow the filters to see others.`
              : `${repairs.length} repair${repairs.length === 1 ? "" : "s"} · ${formatCost(totalCost)} spent`}
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, dot, href }: { label: string; value: number | string; dot: string; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="mt-1 block text-xl font-semibold tabular-nums text-slate-900">{value}</span>
    </>
  );
  const cls = "block rounded-xl border border-slate-200 bg-white px-4 py-3";
  return href ? (
    <Link href={href} className={`${cls} hover:border-slate-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
