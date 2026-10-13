import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchCategoryMaps, fetchPersonNames } from "@/lib/it/ticket-data";
import {
  fetchMetricTickets,
  formatHours,
  formatPercent,
  slaReport,
  technicianReport,
  volumeReport,
} from "@/lib/it/ticket-metrics";

// One definition per report, shared by the page (/it/reports) and the CSV export
// (/it/reports/export), so the two can never disagree.

type Client = Awaited<ReturnType<typeof createClient>>;

export const REPORTS = {
  volume: {
    title: "Ticket Volume",
    description:
      "Tickets raised, by category, priority and month (BRD §7.12). Use it to spot which categories generate the most tickets and whether volume is rising.",
  },
  sla: {
    title: "SLA Compliance",
    description:
      "Per category: average resolution time against the SLA target, tickets still outstanding, and whether the SLA was met (BRD §7.13).",
  },
  technicians: {
    title: "Technician Productivity",
    description:
      "Per IT team member: tickets resolved in the period, average resolution time, and tickets open now (BRD §5.3.18).",
  },
} as const;

export type ReportKind = keyof typeof REPORTS;

export function isReportKind(value: string | undefined): value is ReportKind {
  return Boolean(value && value in REPORTS);
}

export async function buildReport(
  supabase: Client,
  kind: ReportKind,
  from: Date,
  to: Date,
): Promise<{ columns: string[]; rows: string[][] }> {
  const [tickets, maps] = await Promise.all([
    fetchMetricTickets(supabase, from, to),
    fetchCategoryMaps(supabase),
  ]);
  const categoryName = (id: string | null) =>
    (id && maps.categoryNameById.get(id)) ?? "Uncategorised";

  if (kind === "volume") {
    return {
      columns: ["Month", "Category", "Priority", "Ticket count"],
      rows: volumeReport(tickets, from, to, categoryName).map((r) => [
        r.month,
        r.category,
        r.priority,
        String(r.count),
      ]),
    };
  }

  if (kind === "sla") {
    return {
      columns: [
        "Category",
        "Resolved",
        "Avg resolution",
        "Target resolution",
        "Outstanding",
        "Breached",
        "Compliance",
        "SLA status",
      ],
      rows: slaReport(tickets, from, to, categoryName).map((r) => [
        r.category,
        String(r.resolved),
        formatHours(r.avgResolutionHours),
        formatHours(r.targetHours),
        String(r.outstanding),
        String(r.breached),
        formatPercent(r.compliance),
        r.status,
      ]),
    };
  }

  const technicians = technicianReport(tickets, from, to);
  const names = await fetchPersonNames(
    supabase,
    technicians.map((t) => t.personId),
  );
  return {
    columns: ["Technician", "Resolved", "Avg resolution", "Open now"],
    rows: technicians.map((t) => [
      names.get(t.personId) ?? "—",
      String(t.resolved),
      formatHours(t.avgResolutionHours),
      String(t.open),
    ]),
  };
}
