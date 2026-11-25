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
import { BarList, ColumnChart } from "../_components/charts";
import { formatCost } from "../inventory/asset-status";
import { cardClass, secondaryButtonClass } from "../_components/ticket-ui";

const RANGES = [30, 90, 180] as const;
const VIEWS = ["tickets", "team", "assets", "procurement"] as const;
type View = (typeof VIEWS)[number];

type Stat = { label: string; value: string; context?: string; alert?: boolean; href?: string };

// One card, several numbers side by side: far less height than a tile per number.
function StatBand({ stats }: { stats: Stat[] }) {
  const cols =
    stats.length >= 6 ? "lg:grid-cols-6" : stats.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  return (
    <div className={`${cardClass} grid grid-cols-2 divide-slate-100 sm:grid-cols-3 ${cols} [&>*]:border-slate-100`}>
      {stats.map((s, i) => {
        const body = (
          <>
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.alert ? "text-red-600" : "text-slate-900"}`}>
              {s.value}
            </p>
            {s.context && <p className="mt-0.5 truncate text-xs text-slate-400">{s.context}</p>}
          </>
        );
        const cls = `px-5 py-4 ${i > 0 ? "lg:border-l" : ""}`;
        return s.href ? (
          <Link key={s.label} href={s.href} className={`${cls} transition-colors hover:bg-slate-50`}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${cardClass} p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type WorkItem = { key: string; kind: string; tone: string; ref: string; title: string; href: string };

// SCR-06 — IT Dashboard (BRD §5.3.16, §5.3.18, §8 SCR-06). Gated by it.tickets.read.
// Laid out to fit on about one screen: the headline numbers in one band, your own work in one
// short list, and the detail (tickets, team, fixed assets, procurement) behind tabs.
export default async function ItDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; view?: string }>;
}) {
  const { days: daysParam, view: viewParam } = await searchParams;
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
  const canSeeProcurement = procurementAccess.some(Boolean);
  const views: View[] = VIEWS.filter(
    (v) => (v !== "assets" || canSeeAssets) && (v !== "procurement" || canSeeProcurement),
  );
  const view: View = views.find((v) => v === viewParam) ?? "tickets";

  // Only the open tab's extra numbers are loaded.
  const [inventory, procurement] = await Promise.all([
    view === "assets" && canSeeAssets ? inventoryKpis(supabase, from, to) : Promise.resolve(null),
    view === "procurement" && canSeeProcurement ? procurementKpis(supabase, from, to) : Promise.resolve(null),
  ]);

  // Your work: open tickets assigned to me, requests I'm the IT Executive on, and my open
  // checklist tasks. RLS (site-scoped, 0052) already limits rows to what this viewer can see.
  const [myTickets, myLifecycle, myTasks] = await Promise.all([
    personId
      ? supabase
          .schema("it")
          .from("tickets")
          .select("id, ticket_number, subject", { count: "exact" })
          .eq("assigned_to_person_id", personId)
          .not("status", "in", "(Resolved,Closed)")
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, count: 0 }),
    personId && canSeeOnboarding
      ? supabase
          .schema("it")
          .from("onboarding_offboarding")
          .select("id, request_number, kind, employee_name", { count: "exact" })
          .eq("it_executive_person_id", personId)
          .not("status", "in", `(${FINISHED_STATUSES.join(",")})`)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, count: 0 }),
    personId
      ? supabase
          .schema("it")
          .from("checklist_items")
          .select("id, task_name, request_id", { count: "exact" })
          .eq("assigned_to_person_id", personId)
          .in("status", ["Pending", "In Progress"])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(6)
      : Promise.resolve({ data: null, count: 0 }),
  ]);
  const taskRequestIds = [...new Set((myTasks.data ?? []).map((t) => t.request_id))];
  const { data: taskRequests } = taskRequestIds.length
    ? await supabase
        .schema("it")
        .from("onboarding_offboarding")
        .select("id, request_number, employee_name")
        .in("id", taskRequestIds)
    : { data: null };
  const taskRequestById = new Map((taskRequests ?? []).map((r) => [r.id, r]));

  const work: WorkItem[] = [
    ...(myTasks.data ?? []).map((t) => {
      const r = taskRequestById.get(t.request_id);
      return {
        key: `task-${t.id}`,
        kind: "Task",
        tone: "bg-emerald-50 text-emerald-700",
        ref: r?.request_number ?? "Request",
        title: `${t.task_name}${r?.employee_name ? ` · ${r.employee_name}` : ""}`,
        href: `/it/onboarding/${t.request_id}/tasks/${t.id}`,
      };
    }),
    ...(myTickets.data ?? []).map((t) => ({
      key: `ticket-${t.id}`,
      kind: "Ticket",
      tone: "bg-blue-50 text-blue-700",
      ref: t.ticket_number,
      title: t.subject,
      href: `/it/tickets/${t.id}`,
    })),
    ...(myLifecycle.data ?? []).map((r) => ({
      key: `req-${r.id}`,
      kind: "You run",
      tone: "bg-violet-50 text-violet-700",
      ref: r.request_number,
      title: `${r.kind} · ${r.employee_name}`,
      href: `/it/onboarding/${r.id}`,
    })),
  ].slice(0, 6);
  const workCounts = [
    { label: "tasks", n: myTasks.count ?? 0, href: "/it/my-work?type=onboarding" },
    { label: "tickets", n: myTickets.count ?? 0, href: "/it/my-work?type=tickets" },
    ...(canSeeOnboarding ? [{ label: "requests you run", n: myLifecycle.count ?? 0, href: "/it/requests" }] : []),
  ];
  const workTotal = workCounts.reduce((s, c) => s + c.n, 0);

  const categoryName = (id: string | null) => (id && maps.categoryNameById.get(id)) ?? "Uncategorised";
  const kpis = computeKpis(tickets, from, to, now);
  const ageing = ageingBuckets(tickets, now);

  const names =
    view === "team"
      ? await fetchPersonNames(
          supabase,
          technicianReport(tickets, from, to).map((t) => t.personId),
        )
      : new Map<string, string>();

  const href = (next: { days?: number; view?: View }) => {
    const params = new URLSearchParams();
    const d = next.days ?? days;
    const v = next.view ?? view;
    if (d !== 90) params.set("days", String(d));
    if (v !== "tickets") params.set("view", v);
    const qs = params.toString();
    return `/it/dashboard${qs ? `?${qs}` : ""}`;
  };
  const VIEW_LABEL: Record<View, string> = {
    tickets: "Tickets",
    team: "Team",
    assets: "Fixed assets",
    procurement: "Procurement",
  };
  const weekFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });

  return (
    <div className="space-y-5 py-6">
      <PageHeader
        title="IT Dashboard"
        description={`Last ${days} days · open, overdue and age are as of now.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Period" className="inline-flex rounded-lg bg-slate-100 p-1">
              {RANGES.map((d) => (
                <Link
                  key={d}
                  href={href({ days: d })}
                  aria-current={d === days ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    d === days ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {d}d
                </Link>
              ))}
            </nav>
            <Link href="/it/reports" className={secondaryButtonClass}>
              Reports
            </Link>
          </div>
        }
      />

      {/* Headline numbers */}
      <StatBand
        stats={[
          {
            label: "Open tickets",
            value: kpis.open.toLocaleString(),
            context: `${kpis.unassigned} unassigned · ${kpis.escalatedOpen} escalated`,
            href: "/it/requests",
          },
          {
            label: "Overdue",
            value: kpis.overdue.toLocaleString(),
            context: kpis.overdue > 0 ? "Past resolution due" : "None past due",
            alert: kpis.overdue > 0,
          },
          {
            label: "SLA met",
            value: formatPercent(kpis.slaCompliance),
            context: `${kpis.slaMeasured} resolved measured`,
          },
          {
            label: "Avg resolution",
            value: formatHours(kpis.avgResolutionHours),
            context: `${kpis.resolved} resolved`,
          },
          {
            label: "First response",
            value: formatHours(kpis.avgFirstResponseHours),
            context: `${kpis.raised} raised`,
          },
          {
            label: "Satisfaction",
            value: kpis.avgSatisfaction === null ? "—" : `${kpis.avgSatisfaction.toFixed(1)}/5`,
            context: `${kpis.ratingCount} ratings`,
          },
        ]}
      />

      {/* Your work + ticket age */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Your work"
          subtitle={
            workTotal
              ? workCounts
                  .filter((c) => c.n > 0)
                  .map((c) => `${c.n} ${c.label}`)
                  .join(" · ")
              : undefined
          }
          action={
            <Link href="/it/my-work" className="text-sm font-medium text-blue-700 hover:underline">
              My Tasks →
            </Link>
          }
        >
          {work.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nothing assigned to you right now.</p>
          ) : (
            <ul className="-mx-2 divide-y divide-slate-100">
              {work.map((w) => (
                <li key={w.key}>
                  <Link href={w.href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                    <span className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${w.tone}`}>
                      {w.kind}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-blue-700">{w.ref}</span>
                    <span className="min-w-0 truncate text-sm text-slate-600">{w.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Open tickets by age" subtitle={`${tickets.filter(isOpen).length} open`}>
          <BarList
            title="Open tickets by age"
            rows={ageing.map((b) => ({ label: b.label, value: b.count }))}
            emptyText="No open tickets."
          />
        </Card>
      </div>

      {/* Detail, one section at a time */}
      <div>
        <nav aria-label="Sections" className="mb-4 flex gap-6 border-b border-slate-200">
          {views.map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              aria-current={v === view ? "page" : undefined}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                v === view
                  ? "border-blue-600 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </nav>

        {view === "tickets" && <TicketsView tickets={tickets} from={from} to={to} days={days} categoryName={categoryName} kpis={kpis} weekFormat={weekFormat} />}

        {view === "team" && (
          <Card title="Technician workload" subtitle={`Resolved in the last ${days} days, and open now`}>
            <TechnicianTable rows={technicianReport(tickets, from, to)} names={names} />
          </Card>
        )}

        {view === "assets" && inventory && (
          <div className="space-y-3">
            <StatBand
              stats={[
                { label: "In use", value: inventory.inUse.toLocaleString(), context: "With employees", href: "/it/inventory" },
                { label: "In repair", value: inventory.inRepair.toLocaleString(), context: "Repairs open" },
                { label: "In stock", value: inventory.inStock.toLocaleString(), context: "Ready to hand out" },
                {
                  label: "Low consumables",
                  value: inventory.lowStock.toLocaleString(),
                  context: "At or below minimum",
                  alert: inventory.lowStock > 0,
                  href: "/it/inventory/stock",
                },
                { label: "Repair cost", value: formatCost(inventory.repairCost), context: `Closed in ${days}d` },
              ]}
            />
            <Link href="/it/inventory" className="inline-block text-sm font-medium text-blue-700 hover:underline">
              Open Fixed Assets →
            </Link>
          </div>
        )}

        {view === "procurement" && procurement && (
          <div className="space-y-3">
            <StatBand
              stats={[
                {
                  label: "Demands to route",
                  value: procurement.toRoute.toLocaleString(),
                  context: `${procurement.awaitingApproval} awaiting approval`,
                  href: "/it/procurement/demands",
                },
                {
                  label: "Awaiting delivery",
                  value: procurement.awaitingDelivery.toLocaleString(),
                  context:
                    procurement.lateDeliveries > 0
                      ? `${procurement.lateDeliveries} past expected date`
                      : "Approved, not fully received",
                  alert: procurement.lateDeliveries > 0,
                },
                {
                  label: "With Finance",
                  value: formatMoney(procurement.unpaidAtFinance),
                  context:
                    procurement.overdueAtFinance > 0
                      ? `${procurement.overdueAtFinance} overdue (SLA)`
                      : `${procurement.atFinance} invoice${procurement.atFinance === 1 ? "" : "s"} unpaid`,
                  alert: procurement.overdueAtFinance > 0,
                },
                {
                  label: "Spent",
                  value: formatMoney(procurement.spent),
                  context: `${procurement.raised} demands raised`,
                },
              ]}
            />
            <Link href="/it/procurement/reports" className="inline-block text-sm font-medium text-blue-700 hover:underline">
              Procurement reports →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function TicketsView({
  tickets,
  from,
  to,
  days,
  categoryName,
  kpis,
  weekFormat,
}: {
  tickets: Awaited<ReturnType<typeof fetchMetricTickets>>;
  from: Date;
  to: Date;
  days: number;
  categoryName: (id: string | null) => string;
  kpis: ReturnType<typeof computeKpis>;
  weekFormat: Intl.DateTimeFormat;
}) {
  const weeks = weeklyVolume(tickets, from, to);
  const sla = slaReport(tickets, from, to, categoryName).slice(0, 6);
  const byCategory = new Map<string, number>();
  for (const t of tickets) {
    if (!inWindow(t, from, to)) continue;
    const name = categoryName(t.category_id);
    byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
  }
  const categoryRows = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({
      label,
      value,
      tooltip: `${label}: ${value} (${Math.round((value / Math.max(1, kpis.raised)) * 100)}% of tickets)`,
    }));

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        Closure rate <span className="font-medium text-slate-700">{formatPercent(kpis.closureRate)}</span>
        {" · "}Escalated <span className="font-medium text-slate-700">{formatPercent(kpis.escalationRate)}</span>
        {" · "}Reopened <span className="font-medium text-slate-700">{formatPercent(kpis.reopenRate)}</span>
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Raised per week" subtitle={`Last ${days} days`}>
          <ColumnChart
            title={`Tickets raised per week, last ${days} days`}
            points={weeks.map((w) => ({
              label: weekFormat.format(w.start),
              value: w.count,
              tooltip: `Week of ${weekFormat.format(w.start)}: ${w.count} ticket${w.count === 1 ? "" : "s"}`,
            }))}
          />
        </Card>
        <Card title="By category" subtitle="Top 6">
          <BarList title={`Tickets by category, last ${days} days`} rows={categoryRows} />
        </Card>
      </div>
      <Card
        title="SLA by category"
        subtitle="Resolved in the period"
        action={
          <Link href="/it/reports?report=sla" className="text-sm font-medium text-blue-700 hover:underline">
            Full report →
          </Link>
        }
      >
        {sla.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No data for this period.</p>
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
  );
}

function TechnicianTable({
  rows,
  names,
}: {
  rows: ReturnType<typeof technicianReport>;
  names: Map<string, string>;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-400">No assigned tickets yet.</p>;
  return (
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
          {rows.slice(0, 10).map((t) => (
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
  );
}
