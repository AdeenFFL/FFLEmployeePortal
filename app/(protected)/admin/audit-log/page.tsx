import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { applyAuditLogFilters } from "@/lib/admin/audit-query";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { DownloadIcon } from "@/components/icons";
import { getInitials } from "@/lib/format/initials";
import type { AuditAction } from "@/types/database";

const PAGE_SIZE = 25;

function actionTone(
  action: AuditAction,
): "positive" | "warning" | "negative" | "info" {
  if (action === "CREATED") return "positive";
  if (action === "MODIFIED") return "warning";
  if (action === "DELETED") return "negative";
  return "info"; // SYNCED — reserved, no code path writes this yet
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    module?: string;
    user?: string;
    page?: string;
  }>;
}) {
  const { q, from, to, module, user, page: pageParam } = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(pageParam) || 1);

  const { data: allLogs } = await supabase.from("audit_log").select("module, actor_label");
  const modules = [...new Set((allLogs ?? []).map((l) => l.module))].sort();
  const users = [...new Set((allLogs ?? []).map((l) => l.actor_label))].sort();

  const { data: logs, count } = await applyAuditLogFilters(supabase, {
    q,
    from,
    to,
    module,
    user,
  }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const total = count ?? 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  const queryString = new URLSearchParams();
  if (q) queryString.set("q", q);
  if (from) queryString.set("from", from);
  if (to) queryString.set("to", to);
  if (module) queryString.set("module", module);
  if (user) queryString.set("user", user);

  function pageHref(p: number) {
    const params = new URLSearchParams(queryString);
    params.set("page", String(p));
    return `/admin/audit-log?${params.toString()}`;
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Audit Log"
        description="A comprehensive read-only record of system-wide changes and activities."
        action={
          <a
            href={`/admin/audit-log/export?${queryString.toString()}`}
            className="flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <DownloadIcon className="h-4 w-4" />
            Export CSV
          </a>
        }
      />

      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Search</span>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search logs..."
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </label>
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Date Range</span>
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <input
              name="from"
              type="date"
              defaultValue={from ?? ""}
              className="border-0 p-0.5 text-sm focus:outline-none focus:ring-0"
            />
            <span className="text-slate-400">–</span>
            <input
              name="to"
              type="date"
              defaultValue={to ?? ""}
              className="border-0 p-0.5 text-sm focus:outline-none focus:ring-0"
            />
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Module</span>
          <select
            name="module"
            defaultValue={module ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">User</span>
          <select
            name="user"
            defaultValue={user ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">All</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Apply Filters
        </button>
        <Link href="/admin/audit-log" className="text-sm text-slate-500 hover:text-slate-700">
          Clear
        </Link>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Module</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(logs ?? []).map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                      {getInitials(log.actor_label)}
                    </div>
                    {log.actor_label}
                  </div>
                </td>
                <td className="px-4 py-3">{log.module}</td>
                <td className="px-4 py-3">
                  <StatusPill label={log.action} tone={actionTone(log.action)} />
                </td>
                <td className="px-4 py-3 text-slate-600">{log.details}</td>
              </tr>
            ))}
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No audit log entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <p>{total === 0 ? "No entries" : `Showing ${start} to ${end} of ${total} entries`}</p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              Previous
            </Link>
          )}
          {end < total && (
            <Link
              href={pageHref(page + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
