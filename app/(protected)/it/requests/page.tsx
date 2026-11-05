import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits, hasItPermission } from "@/lib/it/ticket-data";
import { formatDate, STATUS_TONE as TICKET_STATUS_TONE } from "@/lib/it/tickets";
import { FINISHED_STATUSES, KIND_TONE, LIFECYCLE_STATUS_TONE } from "@/lib/it/onboarding";
import { cardClass, FormMessage, inputClass, primaryButtonClass, secondaryButtonClass } from "../_components/ticket-ui";
import type { ItLifecycleKind } from "@/types/database";

type Filters = {
  type?: string;
  status?: string;
  site?: string;
  q?: string;
  notice?: string;
  error?: string;
};

type Row = {
  key: string;
  kind: "Ticket" | ItLifecycleKind;
  number: string;
  title: string;
  siteId: string | null;
  status: string;
  statusTone: "positive" | "neutral" | "warning" | "negative" | "info";
  createdAt: string;
  href: string;
};

const PAGE_LIMIT = 200;
const TYPE_OPTIONS = ["Ticket", "Onboarding", "Offboarding", "Replacement"] as const;
const TYPE_TONE: Record<Row["kind"], "positive" | "neutral" | "warning" | "negative" | "info"> = {
  Ticket: "info",
  ...KIND_TONE,
};

// One queue across IT's two separate backends (it.tickets and it.onboarding_offboarding —
// genuinely different tables, not merged; see supabase/migrations for why) instead of the two
// standalone pages this replaces in the sidebar (Ticket Queue, Onboarding / Offboarding). Each
// row still links to its own system's real detail page — this page is a read-only aggregator,
// same approach as app/(protected)/requests/page.tsx takes for the self-service side.
export default async function ItRequestsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const status = filters.status ?? "active";
  const type = filters.type ?? "";
  const supabase = await createClient();

  const [canReadTickets, canReadOnboarding, orgUnits] = await Promise.all([
    hasItPermission(supabase, "it.tickets.read"),
    hasItPermission(supabase, "it.onboarding.read"),
    fetchOrgUnits(supabase),
  ]);

  const q = (filters.q ?? "").replace(/[,()*%]/g, " ").trim();
  const wantTickets = canReadTickets && (type === "" || type === "Ticket");
  const wantLifecycle =
    canReadOnboarding && (type === "" || type === "Onboarding" || type === "Offboarding" || type === "Replacement");

  const [{ data: tickets }, { data: lifecycle }] = await Promise.all([
    wantTickets
      ? (() => {
          let query = supabase
            .schema("it")
            .from("tickets")
            .select("id, ticket_number, subject, priority, status, handling_site_id, created_at")
            .order("created_at", { ascending: false })
            .limit(PAGE_LIMIT);
          if (filters.site) query = query.eq("handling_site_id", filters.site);
          if (status === "active") query = query.neq("status", "Closed");
          if (q) query = query.or(`ticket_number.ilike.%${q}%,subject.ilike.%${q}%`);
          return query.then(checked);
        })()
      : Promise.resolve({ data: null }),
    wantLifecycle
      ? (() => {
          let query = supabase
            .schema("it")
            .from("onboarding_offboarding")
            .select("id, request_number, kind, employee_name, employee_code, site_id, status, created_at")
            .order("created_at", { ascending: false })
            .limit(PAGE_LIMIT);
          if (filters.site) query = query.eq("site_id", filters.site);
          if (status === "active") query = query.not("status", "in", `(${FINISHED_STATUSES.join(",")})`);
          if (type === "Onboarding" || type === "Offboarding" || type === "Replacement") {
            query = query.eq("kind", type);
          }
          if (q) {
            query = query.or(
              `request_number.ilike.%${q}%,employee_name.ilike.%${q}%,employee_code.ilike.%${q}%`,
            );
          }
          return query.then(checked);
        })()
      : Promise.resolve({ data: null }),
  ]);

  const rows: Row[] = [
    ...(tickets ?? []).map((t) => ({
      key: `ticket-${t.id}`,
      kind: "Ticket" as const,
      number: t.ticket_number,
      title: t.subject,
      siteId: t.handling_site_id,
      status: t.status,
      statusTone: TICKET_STATUS_TONE[t.status],
      createdAt: t.created_at,
      href: `/it/tickets/${t.id}`,
    })),
    ...(lifecycle ?? []).map((r) => ({
      key: `lifecycle-${r.id}`,
      kind: r.kind,
      number: r.request_number,
      title: r.employee_name + (r.employee_code ? ` (${r.employee_code})` : ""),
      siteId: r.site_id,
      status: r.status,
      statusTone: LIFECYCLE_STATUS_TONE[r.status],
      createdAt: r.created_at,
      href: `/it/onboarding/${r.id}`,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="py-6">
      <PageHeader
        title="Requests"
        description="Onboarding and offboarding are raised by HR; replacements are raised from the Asset Register."
      />
      <FormMessage error={filters.error} notice={filters.notice} />

      <form method="get" className={`${cardClass} mb-6 grid gap-3 p-4 md:grid-cols-4`}>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Number, subject, name or employee code"
          aria-label="Search"
          className={`${inputClass} md:col-span-2`}
        />
        <select name="type" defaultValue={type} aria-label="Type" className={inputClass}>
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className={inputClass}>
          <option value="active">All active</option>
          <option value="all">All statuses</option>
        </select>
        <select name="site" defaultValue={filters.site ?? ""} aria-label="Site" className={inputClass}>
          <option value="">All sites</option>
          {orgUnits.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2 md:col-span-4">
          <button type="submit" className={primaryButtonClass}>
            Apply filters
          </button>
          <Link href="/it/requests" className={secondaryButtonClass}>
            Reset
          </Link>
        </div>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No requests match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Subject / Employee</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <StatusPill label={r.kind} tone={TYPE_TONE[r.kind]} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={r.href} className="font-medium text-blue-700 hover:underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-800">{r.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {(r.siteId && orgUnits.nameById.get(r.siteId)) ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDate(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill label={r.status} tone={r.statusTone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length >= PAGE_LIMIT && (
          <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
            Showing the latest {PAGE_LIMIT} per type — narrow the filters to see older ones.
          </p>
        )}
      </div>
    </div>
  );
}
