import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { FINISHED_STATUSES } from "@/lib/it/onboarding";
import { fetchCategoryMaps, fetchPersonNames, hasItPermission } from "@/lib/it/ticket-data";
import {
  ageingBuckets,
  computeKpis,
  fetchMetricTickets,
  formatHours,
  formatPercent,
  isOpen,
  inWindow,
  slaReport,
  technicianReport,
  weeklyVolume,
} from "@/lib/it/ticket-metrics";
import { formatMoney } from "@/lib/it/procurement";
import { PROCUREMENT_REPORT_KEYS, procurementKpis } from "@/lib/it/procurement-reports";
import { inventoryKpis } from "@/lib/it/assets";
import { BarList, ColumnChart, StatTile } from "../_components/charts";
import { formatCost } from "../inventory/asset-status";
import { cardClass, secondaryButtonClass } from "../_components/ticket-ui";

const RANGES = [30, 90, 180] as const;

function Card({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className={`${cardClass} p-6`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// SCR-06 — IT Dashboard (BRD §5.3.16, §5.3.18, §8 SCR-06). Gated by it.tickets.read.
// Talha's <InventoryKpis> (07-it-inventory-plan.md §2.1) slots in below the KPI row once his
// assets track ships.
export default async function ItDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const days = RANGES.find((d) => String(d) === daysParam) ?? 90;
  const supabase = await createClient();

  const now = new Date();
  const to = new Date(now);
  const from = new Date(now.getTime() - days * 24 * 3_600_000);

  const [tickets, maps, canSeeOnboarding, procurementAccess, canSeeAssets, { data: personId }] = await Promise.all([
    fetchMetricTickets(supabase, from, to),
    fetchCategoryMaps(supabase),
    hasItPermission(supabase, "it.onboarding.read"),
    Promise.all(PROCUREMENT_REPORT_KEYS.map((k) => hasItPermission(supabase, k))),
    hasItPermission(supabase, "it.assets.read"),
    supabase.rpc("current_person_id"),
  ]);
  const inventory = canSeeAssets ? await inventoryKpis(supabase, from, to) : null;
  // <ProcurementKpis> (09-it-procurement-plan.md Phase 7) — only for procurement staff / Finance.
  const procurement = procurementAccess.some(Boolean) ? await procurementKpis(supabase, from, to) : null;

  // "My open work" (IT Module Onboarding Overhaul Phase 1, item 4): an actionable list on top of
  // the aggregate KPIs below — open tickets assigned to me, plus onboarding/offboarding work
  // either I'm the IT Executive on or have a pending checklist item on. RLS (now site-scoped —
  // 0052_it_onboarding_site_scoping.sql) already limits both to what this viewer can see.
  const [{ data: myTickets }, { data: myLifecycle }, { data: myTasks }] = await Promise.all([
    personId
      ? supabase
          .schema("it")
          .from("tickets")
          .select("id, ticket_number, subject, priority, status")
          .eq("assigned_to_person_id", personId)
          .not("status", "in", "(Resolved,Closed)")
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),
    personId && canSeeOnboarding
      ? supabase
          .schema("it")
          .from("onboarding_offboarding")
          .select("id, request_number, kind, employee_name, status")
          .eq("it_executive_person_id", personId)
          .not("status", "in", `(${FINISHED_STATUSES.join(",")})`)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),
    personId && canSeeOnboarding
      ? supabase
          .schema("it")
          .from("checklist_items")
          .select("id, task_name, request_id")
          .eq("assigned_to_person_id", personId)
          .in("status", ["Pending", "In Progress"])
          .limit(8)
      : Promise.resolve({ data: null }),
  ]);
  const taskRequestIds = (myTasks ?? []).map((t) => t.request_id);
  const { data: taskRequests } = taskRequestIds.length
    ? await supabase
        .schema("it")
        .from("onboarding_offboarding")
        .select("id, request_number, employee_name")
        .in("id", taskRequestIds)
    : { data: null };
  const taskRequestById = new Map((taskRequests ?? []).map((r) => [r.id, r]));

  const categoryName = (id: string | null) =>
    (id && maps.categoryNameById.get(id)) ?? "Uncategorised";
  const kpis = computeKpis(tickets, from, to, now);
  const weeks = weeklyVolume(tickets, from, to);
  const sla = slaReport(tickets, from, to, categoryName).slice(0, 8);
  const technicians = technicianReport(tickets, from, to).slice(0, 8);
  const ageing = ageingBuckets(tickets, now);

  const byCategory = new Map<string, number>();
  for (const t of tickets) {
    if (!inWindow(t, from, to)) continue;
    const name = categoryName(t.category_id);
    byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
  }
  const categoryRows = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({
      label,
      value,
      tooltip: `${label}: ${value} (${Math.round((value / Math.max(1, kpis.raised)) * 100)}% of tickets)`,
    }));

  // Pending onboarding / offboarding checklist items on requests that aren't finished.
  let pendingOnboardingTasks: number | null = null;
  if (canSeeOnboarding) {
    const { data: activeRequests } = await supabase
      .schema("it")
      .from("onboarding_offboarding")
      .select("id")
      .not("status", "in", `(${FINISHED_STATUSES.join(",")})`);
    const ids = (activeRequests ?? []).map((r) => r.id);
    if (ids.length === 0) {
      pendingOnboardingTasks = 0;
    } else {
      const { count } = await supabase
        .schema("it")
        .from("checklist_items")
        .select("id", { count: "exact", head: true })
        .in("request_id", ids)
        .in("status", ["Pending", "In Progress"]);
      pendingOnboardingTasks = count ?? 0;
    }
  }

  const names = await fetchPersonNames(
    supabase,
    technicians.map((t) => t.personId),
  );

  const weekFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

  return (
    <div className="py-6">
      <PageHeader
        title="IT Dashboard"
        description="IT support load, SLA performance and onboarding work at a glance."
        action={
          <Link href="/it/reports" className={secondaryButtonClass}>
            Reports &amp; CSV export
          </Link>
        }
      />

      {/* Filters: one row, above everything they affect. */}
      <nav aria-label="Time range" className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Period:</span>
        {RANGES.map((d) => (
          <Link
            key={d}
            href={`/it/dashboard?days=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              d === days
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Last {d} days
          </Link>
        ))}
        <span className="text-xs text-slate-400">
          Open, overdue and ageing are always as of now.
        </span>
      </nav>

      {(myTickets?.length || myLifecycle?.length || myTasks?.length) ? (
        <div className="mb-6 grid gap-6 xl:grid-cols-3">
          <Card title="My open tickets" subtitle="Assigned to you">
            {myTickets?.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {myTickets.map((t) => (
                  <li key={t.id} className="py-2">
                    <Link href={`/it/tickets/${t.id}`} className="font-medium text-blue-700 hover:underline">
                      {t.ticket_number}
                    </Link>
                    <span className="ml-2 text-slate-600">{t.subject}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">Nothing assigned to you.</p>
            )}
          </Card>
          <Card title="My onboarding work" subtitle="Requests you're the IT Executive on">
            {myLifecycle?.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {myLifecycle.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={`/it/onboarding/${r.id}`} className="font-medium text-blue-700 hover:underline">
                      {r.request_number}
                    </Link>
                    <span className="ml-2 text-slate-600">{r.employee_name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">No requests assigned to you.</p>
            )}
          </Card>
          <Card title="My onboarding tasks" subtitle="Checklist items assigned to you">
            {myTasks?.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {myTasks.map((t) => {
                  const r = taskRequestById.get(t.request_id);
                  return (
                    <li key={t.id} className="py-2">
                      <Link href={`/it/onboarding/${t.request_id}`} className="font-medium text-blue-700 hover:underline">
                        {r?.request_number ?? "Request"}
                      </Link>
                      <span className="ml-2 text-slate-600">
                        {t.task_name}
                        {r?.employee_name ? ` — ${r.employee_name}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">No tasks assigned to you.</p>
            )}
          </Card>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Open tickets"
          value={kpis.open.toLocaleString()}
          context={`${kpis.unassigned} unassigned · ${kpis.escalatedOpen} escalated`}
        />
        <StatTile
          label="Overdue"
          value={kpis.overdue.toLocaleString()}
          alert={kpis.overdue > 0 && "Past resolution due date"}
          context="Within SLA"
        />
        <StatTile
          label="SLA compliance"
          value={formatPercent(kpis.slaCompliance)}
          context={`${kpis.slaMeasured} resolved tickets measured`}
        />
        <StatTile
          label="Avg resolution time"
          value={formatHours(kpis.avgResolutionHours)}
          context={`${kpis.resolved} resolved in period`}
        />
        <StatTile
          label="Avg first response"
          value={formatHours(kpis.avgFirstResponseHours)}
          context={`${kpis.raised} raised in period`}
        />
        <StatTile
          label="Closure rate"
          value={formatPercent(kpis.closureRate)}
          context={`Escalation rate ${formatPercent(kpis.escalationRate)}`}
        />
        <StatTile
          label="Requester satisfaction"
          value={kpis.avgSatisfaction === null ? "—" : `${kpis.avgSatisfaction.toFixed(1)} / 5`}
          context={`${kpis.ratingCount} ratings`}
        />
        {pendingOnboardingTasks !== null ? (
          <StatTile
            label="Pending onboarding tasks"
            value={pendingOnboardingTasks.toLocaleString()}
            context="Checklist items not yet done"
          />
        ) : (
          <StatTile
            label="Reopened"
            value={formatPercent(kpis.reopenRate)}
            context="Of tickets resolved in period"
          />
        )}
      </div>

      {inventory && (
        <section className="mb-6" aria-labelledby="inventory-kpis">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="inventory-kpis" className="text-base font-semibold text-slate-900">
              Inventory
            </h2>
            <Link href="/it/inventory" className="text-sm font-medium text-blue-700 hover:underline">
              Asset Register →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatTile label="In use" value={inventory.inUse.toLocaleString()} context="Assigned to employees" />
            <StatTile label="In repair" value={inventory.inRepair.toLocaleString()} context="Repairs and services open" />
            <StatTile label="In stock" value={inventory.inStock.toLocaleString()} context="Ready to hand out" />
            <StatTile
              label="Low stock"
              value={inventory.lowStock.toLocaleString()}
              alert={inventory.lowStock > 0 && "At or below minimum"}
              context="Consumables per site"
            />
            <StatTile label="Repair cost" value={formatCost(inventory.repairCost)} context="Closed in period" />
          </div>
        </section>
      )}

      {procurement && (
        <section className="mb-6" aria-labelledby="procurement-kpis">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="procurement-kpis" className="text-base font-semibold text-slate-900">
              Procurement
            </h2>
            <Link href="/it/procurement/reports" className="text-sm font-medium text-blue-700 hover:underline">
              Procurement reports
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              label="Demands to route"
              value={procurement.toRoute.toLocaleString()}
              context={`${procurement.awaitingApproval} awaiting approval`}
            />
            <StatTile
              label="Awaiting delivery"
              value={procurement.awaitingDelivery.toLocaleString()}
              alert={procurement.lateDeliveries > 0 && `${procurement.lateDeliveries} past expected date`}
              context="Approved, not fully received"
            />
            <StatTile
              label="With Finance"
              value={formatMoney(procurement.unpaidAtFinance)}
              alert={procurement.overdueAtFinance > 0 && `${procurement.overdueAtFinance} overdue (SLA)`}
              context={`${procurement.atFinance} invoice${procurement.atFinance === 1 ? "" : "s"} unpaid`}
            />
            <StatTile
              label="Spent"
              value={formatMoney(procurement.spent)}
              context={`Last ${days} days · ${procurement.raised} demands raised`}
            />
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Tickets raised per week" subtitle={`Last ${days} days`}>
          <ColumnChart
            title={`Tickets raised per week, last ${days} days`}
            points={weeks.map((w) => ({
              label: weekFormat.format(w.start),
              value: w.count,
              tooltip: `Week of ${weekFormat.format(w.start)}: ${w.count} ticket${w.count === 1 ? "" : "s"}`,
            }))}
          />
        </Card>

        <Card title="Tickets by category" subtitle={`Top categories, last ${days} days`}>
          <BarList title={`Tickets by category, last ${days} days`} rows={categoryRows} />
        </Card>

        <Card title="Open ticket age" subtitle={`${tickets.filter(isOpen).length} open tickets`}>
          <BarList
            title="Open tickets by age"
            rows={ageing.map((b) => ({ label: b.label, value: b.count }))}
            emptyText="No open tickets."
          />
        </Card>

        <Card
          title="SLA by category"
          subtitle={`Tickets resolved in the last ${days} days`}
          action={
            <Link href={`/it/reports?report=sla`} className="text-sm font-medium text-blue-700 hover:underline">
              Full report
            </Link>
          }
        >
          {sla.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No data for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 font-medium">Avg resolution</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 pr-3 font-medium">Outstanding</th>
                    <th className="py-2 font-medium">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {sla.map((r) => (
                    <tr key={r.category}>
                      <td className="py-2 pr-3 text-slate-800">{r.category}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatHours(r.avgResolutionHours)}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatHours(r.targetHours)}</td>
                      <td className="py-2 pr-3 text-slate-600">{r.outstanding}</td>
                      <td className="py-2">
                        <span
                          className={
                            r.status === "Met"
                              ? "font-medium text-emerald-700"
                              : r.status === "Breached"
                                ? "font-medium text-red-600"
                                : "text-slate-400"
                          }
                        >
                          {r.status === "Met" ? "✓ Met" : r.status === "Breached" ? `✕ Breached (${r.breached})` : r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Technician workload" subtitle={`Resolved in the last ${days} days, and open now`}>
          {technicians.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No assigned tickets yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Technician</th>
                    <th className="py-2 pr-3 font-medium">Resolved</th>
                    <th className="py-2 pr-3 font-medium">Avg resolution</th>
                    <th className="py-2 font-medium">Open now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {technicians.map((t) => (
                    <tr key={t.personId}>
                      <td className="py-2 pr-3 text-slate-800">{names.get(t.personId) ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">{t.resolved}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatHours(t.avgResolutionHours)}</td>
                      <td className="py-2 text-slate-600">{t.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
