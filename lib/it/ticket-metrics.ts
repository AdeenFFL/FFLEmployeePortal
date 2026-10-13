import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ItTicket } from "@/types/database";

// Ticket KPIs and report rows for the IT dashboard (SCR-06) and reports (BRD §5.3.16–5.3.18,
// §7.12–7.13). Computed in the app from one ticket fetch rather than in SQL views, so the
// numbers follow the same RLS as every other screen and need no migration.

type Client = SupabaseClient<Database>;

export type MetricTicket = Pick<
  ItTicket,
  | "id"
  | "ticket_number"
  | "category_id"
  | "priority"
  | "status"
  | "assigned_to_person_id"
  | "created_at"
  | "first_responded_at"
  | "resolved_at"
  | "closed_at"
  | "resolution_due_at"
  | "is_escalated"
  | "reopen_count"
  | "satisfaction_rating"
>;

const METRIC_COLUMNS =
  "id, ticket_number, category_id, priority, status, assigned_to_person_id, created_at, first_responded_at, resolved_at, closed_at, resolution_due_at, is_escalated, reopen_count, satisfaction_rating";

const OPEN_STATUSES = ["Open", "Assigned", "In Progress", "On Hold"] as const;
const PAGE = 1000; // PostgREST's default max rows per request
const MAX_ROWS = 20000;

// Tickets raised in [from, to) plus every ticket still open (so backlog and ageing are complete
// even when it was raised before the window). Paged, because PostgREST caps each response.
export async function fetchMetricTickets(client: Client, from: Date, to: Date) {
  const rows: MetricTicket[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await client
      .schema("it")
      .from("tickets")
      .select(METRIC_COLUMNS)
      .or(
        `and(created_at.gte.${from.toISOString()},created_at.lt.${to.toISOString()}),status.in.(${OPEN_STATUSES.map((s) => `"${s}"`).join(",")})`,
      )
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as MetricTicket[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const HOUR = 3_600_000;

function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
}

function average(values: number[]) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function isOpen(t: MetricTicket) {
  return (OPEN_STATUSES as readonly string[]).includes(t.status);
}

export function inWindow(t: MetricTicket, from: Date, to: Date) {
  const created = new Date(t.created_at).getTime();
  return created >= from.getTime() && created < to.getTime();
}

// BRD §5.3.18 KPIs. "Resolved in window" = resolved_at falls inside [from, to).
export function computeKpis(tickets: MetricTicket[], from: Date, to: Date, now = new Date()) {
  const raised = tickets.filter((t) => inWindow(t, from, to));
  const resolved = tickets.filter(
    (t) =>
      t.resolved_at &&
      new Date(t.resolved_at).getTime() >= from.getTime() &&
      new Date(t.resolved_at).getTime() < to.getTime(),
  );
  const open = tickets.filter(isOpen);
  const withSla = resolved.filter((t) => t.resolution_due_at);
  const met = withSla.filter(
    (t) => new Date(t.resolved_at!).getTime() <= new Date(t.resolution_due_at!).getTime(),
  );
  const ratings = raised.map((t) => t.satisfaction_rating).filter((r): r is number => r !== null);

  return {
    raised: raised.length,
    resolved: resolved.length,
    open: open.length,
    unassigned: open.filter((t) => !t.assigned_to_person_id).length,
    overdue: open.filter(
      (t) => t.resolution_due_at && new Date(t.resolution_due_at).getTime() < now.getTime(),
    ).length,
    escalatedOpen: open.filter((t) => t.is_escalated).length,
    avgResolutionHours: average(resolved.map((t) => hoursBetween(t.created_at, t.resolved_at!))),
    avgFirstResponseHours: average(
      raised
        .filter((t) => t.first_responded_at)
        .map((t) => hoursBetween(t.created_at, t.first_responded_at!)),
    ),
    slaCompliance: withSla.length ? met.length / withSla.length : null,
    slaMeasured: withSla.length,
    closureRate: raised.length
      ? raised.filter((t) => t.status === "Closed").length / raised.length
      : null,
    escalationRate: raised.length
      ? raised.filter((t) => t.is_escalated).length / raised.length
      : null,
    reopenRate: resolved.length
      ? resolved.filter((t) => t.reopen_count > 0).length / resolved.length
      : null,
    avgSatisfaction: average(ratings),
    ratingCount: ratings.length,
  };
}

// Monday-start weeks covering [from, to), for the volume trend.
export function weeklyVolume(tickets: MetricTicket[], from: Date, to: Date) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const weeks: { start: Date; count: number }[] = [];
  for (let d = new Date(start); d < to; d.setDate(d.getDate() + 7)) {
    weeks.push({ start: new Date(d), count: 0 });
  }
  for (const t of tickets) {
    if (!inWindow(t, from, to)) continue;
    const created = new Date(t.created_at).getTime();
    const index = Math.floor((created - start.getTime()) / (7 * 24 * HOUR));
    if (weeks[index]) weeks[index].count++;
  }
  return weeks;
}

// §7.12 Ticket Volume Report rows: category × priority × month.
export function volumeReport(
  tickets: MetricTicket[],
  from: Date,
  to: Date,
  categoryName: (id: string | null) => string,
) {
  const counts = new Map<string, { category: string; priority: string; month: string; count: number }>();
  for (const t of tickets) {
    if (!inWindow(t, from, to)) continue;
    const month = t.created_at.slice(0, 7);
    const category = categoryName(t.category_id);
    const key = `${category}|${t.priority}|${month}`;
    const row = counts.get(key) ?? { category, priority: t.priority, month, count: 0 };
    row.count++;
    counts.set(key, row);
  }
  const priorityRank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<string, number>;
  return [...counts.values()].sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      a.category.localeCompare(b.category) ||
      priorityRank[a.priority] - priorityRank[b.priority],
  );
}

// §7.13 SLA Compliance Report rows, one per category. Target = the average SLA window the
// category's resolved tickets were given (SLA is set per priority, BRD §5.3.8).
export function slaReport(
  tickets: MetricTicket[],
  from: Date,
  to: Date,
  categoryName: (id: string | null) => string,
) {
  const groups = new Map<string, MetricTicket[]>();
  for (const t of tickets) {
    const name = categoryName(t.category_id);
    groups.set(name, [...(groups.get(name) ?? []), t]);
  }

  return [...groups.entries()]
    .map(([category, rows]) => {
      const resolved = rows.filter(
        (t) =>
          t.resolved_at &&
          new Date(t.resolved_at).getTime() >= from.getTime() &&
          new Date(t.resolved_at).getTime() < to.getTime(),
      );
      const withSla = resolved.filter((t) => t.resolution_due_at);
      const breached = withSla.filter(
        (t) => new Date(t.resolved_at!).getTime() > new Date(t.resolution_due_at!).getTime(),
      ).length;
      const avgResolution = average(resolved.map((t) => hoursBetween(t.created_at, t.resolved_at!)));
      const avgTarget = average(withSla.map((t) => hoursBetween(t.created_at, t.resolution_due_at!)));
      return {
        category,
        resolved: resolved.length,
        avgResolutionHours: avgResolution,
        targetHours: avgTarget,
        outstanding: rows.filter(isOpen).length,
        breached,
        compliance: withSla.length ? (withSla.length - breached) / withSla.length : null,
        status:
          withSla.length === 0 ? "No data" : breached === 0 ? "Met" : ("Breached" as string),
      };
    })
    .filter((r) => r.resolved > 0 || r.outstanding > 0)
    .sort((a, b) => b.resolved + b.outstanding - (a.resolved + a.outstanding));
}

// BRD §5.3.18 "technician productivity".
export function technicianReport(tickets: MetricTicket[], from: Date, to: Date) {
  const byPerson = new Map<string, { resolved: number; open: number; hours: number[] }>();
  for (const t of tickets) {
    if (!t.assigned_to_person_id) continue;
    const row = byPerson.get(t.assigned_to_person_id) ?? { resolved: 0, open: 0, hours: [] };
    if (isOpen(t)) row.open++;
    if (
      t.resolved_at &&
      new Date(t.resolved_at).getTime() >= from.getTime() &&
      new Date(t.resolved_at).getTime() < to.getTime()
    ) {
      row.resolved++;
      row.hours.push(hoursBetween(t.created_at, t.resolved_at));
    }
    byPerson.set(t.assigned_to_person_id, row);
  }
  return [...byPerson.entries()]
    .map(([personId, r]) => ({
      personId,
      resolved: r.resolved,
      open: r.open,
      avgResolutionHours: average(r.hours),
    }))
    .sort((a, b) => b.resolved - a.resolved || b.open - a.open);
}

// Open-ticket ageing buckets (BRD §5.3.16 "ticket aging").
export function ageingBuckets(tickets: MetricTicket[], now = new Date()) {
  const buckets = [
    { label: "< 1 day", max: 24, count: 0 },
    { label: "1–3 days", max: 72, count: 0 },
    { label: "3–7 days", max: 168, count: 0 },
    { label: "> 7 days", max: Infinity, count: 0 },
  ];
  for (const t of tickets.filter(isOpen)) {
    const age = (now.getTime() - new Date(t.created_at).getTime()) / HOUR;
    buckets.find((b) => age < b.max)!.count++;
  }
  return buckets;
}

export function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatPercent(ratio: number | null) {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

// Report window from ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive), defaulting to the last
// `defaultDays` days.
export function parseWindow(fromParam?: string, toParam?: string, defaultDays = 90) {
  const valid = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
  const to = valid(toParam) ? new Date(`${toParam}T00:00:00`) : new Date();
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 1); // exclusive upper bound
  const from = valid(fromParam)
    ? new Date(`${fromParam}T00:00:00`)
    : new Date(to.getTime() - defaultDays * 24 * HOUR);
  return { from, to };
}

export function toDateInput(d: Date) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
