import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import {
  checked,
  fetchCategoryMaps,
  fetchOrgUnits,
  fetchPersonNames,
  fetchTicketScope,
} from "@/lib/it/ticket-data";
import {
  formatDate,
  slaState,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@/lib/it/tickets";
import {
  cardClass,
  FormMessage,
  inputClass,
  PriorityBadge,
  primaryButtonClass,
  secondaryButtonClass,
  SlaBadge,
  StatusBadge,
} from "../_components/ticket-ui";
import type { ItTicketPriority, ItTicketStatus } from "@/types/database";

type Filters = {
  site?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  q?: string;
  from?: string;
  to?: string;
  notice?: string;
  error?: string;
};

const PAGE_LIMIT = 200;

// SCR-03 — IT Ticket Queue (BRD §5.3.4, §5.3.10). Gated by it.tickets.read in
// lib/auth/route-permissions.ts; RLS returns every ticket to holders of that permission.
export default async function ItTicketQueuePage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const status = filters.status ?? "active";
  const assignee = filters.assignee ?? "";
  const supabase = await createClient();

  const [{ data: personId }, { data: staff }, maps, scope, orgUnits] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.schema("it").rpc("list_it_staff"),
    fetchCategoryMaps(supabase),
    fetchTicketScope(supabase),
    fetchOrgUnits(supabase),
  ]);

  // Sites this viewer can filter by: every site for HQ, otherwise their own IT team's sites.
  const siteOptions = scope.readAll
    ? orgUnits.sites
    : orgUnits.sites.filter((s) => scope.siteIds.includes(s.id));

  let query = supabase
    .schema("it")
    .from("tickets")
    .select(
      "id, ticket_number, subject, category_id, priority, status, requester_person_id, assigned_to_person_id, created_at, resolution_due_at, resolved_at, is_escalated, handling_site_id",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT);

  if (filters.site === "unrouted") query = query.is("handling_site_id", null);
  else if (filters.site) query = query.eq("handling_site_id", filters.site);

  if (status === "active") query = query.neq("status", "Closed");
  else if (TICKET_STATUSES.includes(status as ItTicketStatus)) {
    query = query.eq("status", status as ItTicketStatus);
  }

  const priority = filters.priority as ItTicketPriority | undefined;
  if (priority && TICKET_PRIORITIES.includes(priority)) query = query.eq("priority", priority);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (assignee === "mine" && personId) query = query.eq("assigned_to_person_id", personId);
  else if (assignee === "unassigned") query = query.is("assigned_to_person_id", null);
  else if (assignee) query = query.eq("assigned_to_person_id", assignee);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lt("created_at", `${filters.to}T23:59:59.999`);

  // Strip characters PostgREST treats as filter syntax before building the or() expression.
  const q = (filters.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) query = query.or(`ticket_number.ilike.%${q}%,subject.ilike.%${q}%`);

  const { data: tickets } = checked(await query);
  const rows = tickets ?? [];

  const names = await fetchPersonNames(
    supabase,
    rows.flatMap((t) => [t.requester_person_id, t.assigned_to_person_id]),
  );

  const now = new Date();
  const open = rows.filter((t) => t.status !== "Resolved" && t.status !== "Closed");
  const summary = [
    { label: "Open", value: open.length },
    { label: "Unassigned", value: open.filter((t) => !t.assigned_to_person_id).length },
    {
      label: "Overdue",
      value: open.filter((t) => slaState(t, now) === "overdue").length,
      alert: true,
    },
    { label: "Escalated", value: open.filter((t) => t.is_escalated).length, alert: true },
  ];

  const topCategories = maps.categories.filter((c) => !c.parent_id);

  return (
    <div className="py-6">
      <PageHeader
        title="IT Ticket Queue"
        description={
          scope.readAll
            ? "Every site's IT tickets (HQ view)."
            : siteOptions.length > 0
              ? `Tickets handled at ${siteOptions.map((s) => s.name).join(", ")}.`
              : "Tickets assigned to you."
        }
      />
      <FormMessage error={filters.error} notice={filters.notice} />
      {!scope.readAll && scope.siteIds.length === 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You&apos;re not on any site&apos;s IT team yet, so you only see tickets assigned to you.
          Ask an IT admin to add you under IT Settings → Sites &amp; IT staff.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className={`${cardClass} px-5 py-4`}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p
              className={`mt-1 text-2xl font-bold ${
                s.alert && s.value > 0 ? "text-red-600" : "text-slate-900"
              }`}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <form method="get" className={`${cardClass} mb-6 grid gap-3 p-4 md:grid-cols-4 lg:grid-cols-8`}>
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Ticket # or subject"
          aria-label="Search"
          className={`${inputClass} lg:col-span-2`}
        />
        <select name="status" defaultValue={status} aria-label="Status" className={inputClass}>
          <option value="active">All active</option>
          <option value="all">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={filters.priority ?? ""}
          aria-label="Priority"
          className={inputClass}
        >
          <option value="">Any priority</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={filters.category ?? ""}
          aria-label="Category"
          className={inputClass}
        >
          <option value="">Any category</option>
          {topCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {(scope.readAll || siteOptions.length > 1) && (
          <select name="site" defaultValue={filters.site ?? ""} aria-label="Handled at" className={inputClass}>
            <option value="">All my sites</option>
            {siteOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {scope.readAll && <option value="unrouted">HQ / unrouted</option>}
          </select>
        )}
        <select name="assignee" defaultValue={assignee} aria-label="Assignee" className={inputClass}>
          <option value="">Anyone</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {(staff ?? []).map((s) => (
            <option key={s.person_id} value={s.person_id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={filters.from ?? ""}
          aria-label="Submitted from"
          className={inputClass}
        />
        <input
          type="date"
          name="to"
          defaultValue={filters.to ?? ""}
          aria-label="Submitted to"
          className={inputClass}
        />
        <div className="flex gap-2 md:col-span-4 lg:col-span-8">
          <button type="submit" className={primaryButtonClass}>
            Apply filters
          </button>
          <Link href="/it/tickets" className={secondaryButtonClass}>
            Reset
          </Link>
        </div>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No tickets match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Requester</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                  <th className="px-4 py-3 font-medium">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/it/tickets/${t.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {t.ticket_number}
                      </Link>
                      {t.is_escalated && (
                        <span className="ml-2 text-xs font-semibold text-red-600">ESC</span>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-800">{t.subject}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {(t.handling_site_id && orgUnits.nameById.get(t.handling_site_id)) ??
                        "HQ / unrouted"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {(t.category_id && maps.categoryNameById.get(t.category_id)) ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {names.get(t.requester_person_id) ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDate(t.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.assigned_to_person_id ? (
                        (names.get(t.assigned_to_person_id) ?? "—")
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SlaBadge ticket={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === PAGE_LIMIT && (
          <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
            Showing the latest {PAGE_LIMIT} tickets — narrow the filters to see older ones.
          </p>
        )}
      </div>
    </div>
  );
}
