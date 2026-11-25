import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, hasItPermission } from "@/lib/it/ticket-data";
import { STATUS_TONE as TICKET_STATUS_TONE } from "@/lib/it/tickets";
import { FINISHED_STATUSES, LIFECYCLE_STATUS_TONE } from "@/lib/it/onboarding";
import { FormMessage } from "../_components/ticket-ui";
import { RequestsList, type RequestKind, type RequestRow } from "./requests-list";

const PAGE_LIMIT = 200;

// One queue across IT's two separate backends (it.tickets and it.onboarding_offboarding —
// genuinely different tables, not merged) instead of the two standalone pages this replaces in
// the sidebar (Ticket Queue, Onboarding / Offboarding). Each row links to its own system's real
// detail page. The latest PAGE_LIMIT of each are loaded once; search, type, site and Active / All
// filter in the browser (requests-list.tsx).
export default async function ItRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();

  const [canReadTickets, canReadOnboarding, orgUnits] = await Promise.all([
    hasItPermission(supabase, "it.tickets.read"),
    hasItPermission(supabase, "it.onboarding.read"),
    fetchOrgUnits(supabase),
  ]);

  const [{ data: tickets }, { data: lifecycle }] = await Promise.all([
    canReadTickets
      ? supabase
          .schema("it")
          .from("tickets")
          .select("id, ticket_number, subject, status, handling_site_id, created_at")
          .order("created_at", { ascending: false })
          .limit(PAGE_LIMIT)
          .then(checked)
      : Promise.resolve({ data: null }),
    canReadOnboarding
      ? supabase
          .schema("it")
          .from("onboarding_offboarding")
          .select("id, request_number, kind, employee_name, employee_code, site_id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(PAGE_LIMIT)
          .then(checked)
      : Promise.resolve({ data: null }),
  ]);

  const siteName = (id: string | null) => (id ? (orgUnits.nameById.get(id) ?? null) : null);
  const rows: RequestRow[] = [
    ...(tickets ?? []).map((t) => ({
      key: `ticket-${t.id}`,
      kind: "Ticket" as const,
      number: t.ticket_number,
      title: t.subject,
      siteId: t.handling_site_id,
      siteName: siteName(t.handling_site_id),
      status: t.status,
      statusTone: TICKET_STATUS_TONE[t.status],
      active: t.status !== "Closed",
      createdAt: t.created_at,
      href: `/it/tickets/${t.id}`,
    })),
    ...(lifecycle ?? []).map((r) => ({
      key: `lifecycle-${r.id}`,
      kind: r.kind,
      number: r.request_number,
      title: r.employee_name + (r.employee_code ? ` (${r.employee_code})` : ""),
      siteId: r.site_id,
      siteName: siteName(r.site_id),
      status: r.status,
      statusTone: LIFECYCLE_STATUS_TONE[r.status],
      active: !FINISHED_STATUSES.includes(r.status),
      createdAt: r.created_at,
      href: `/it/onboarding/${r.id}`,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const kinds: RequestKind[] = [
    ...(canReadTickets ? (["Ticket"] as const) : []),
    ...(canReadOnboarding ? (["Onboarding", "Offboarding", "Replacement"] as const) : []),
  ];

  return (
    <div className="py-6">
      <PageHeader
        title="Requests"
        description="Tickets, and onboarding / offboarding raised by HR. Replacements are raised from Fixed Assets."
      />
      <FormMessage error={error} notice={notice} />
      <RequestsList
        rows={rows}
        kinds={kinds}
        sites={orgUnits.sites.map((s) => ({ id: s.id, name: s.name }))}
        limitReached={(tickets ?? []).length >= PAGE_LIMIT || (lifecycle ?? []).length >= PAGE_LIMIT}
      />
    </div>
  );
}
