import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { primaryButtonClass } from "../it/_components/ticket-ui";

// A single, read-only aggregator across the portal's separate ticket/request systems (HR
// tickets, IT tickets, IT onboarding/offboarding) — built instead of merging those backends
// into one schema, since they're structurally very different (HR's is a simple subject/body/
// status table; IT's ticket system is a full ITSM model; onboarding/offboarding is its own
// lifecycle). Each row still links into its own system's real detail/list page; this page
// doesn't duplicate any of their actions.

type Row = {
  key: string;
  module: "HR" | "IT" | "Onboarding" | "Offboarding";
  label: string;
  status: string;
  createdAt: string;
  href: string;
  progress?: string;
};

const MODULE_BADGE: Record<Row["module"], string> = {
  HR: "bg-purple-50 text-purple-700",
  IT: "bg-blue-50 text-blue-700",
  Onboarding: "bg-emerald-50 text-emerald-700",
  Offboarding: "bg-amber-50 text-amber-700",
};

const STATUS_TONE: Record<string, "positive" | "neutral" | "warning" | "negative" | "info"> = {
  Open: "info",
  "In Progress": "warning",
  "Under Review": "info",
  "Awaiting Confirmation": "warning",
  "Pending Final Review": "warning",
  Submitted: "info",
  "In Clearance": "warning",
  Resolved: "positive",
  Completed: "positive",
  Closed: "neutral",
  Cancelled: "neutral",
};

// last_working_date is a plain date ("2026-11-30"): read it as Karachi midnight → "30 Nov 2026".
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Karachi",
});
const formatDay = (value: string) => dayFormat.format(new Date(`${value}T00:00:00+05:00`));

export default async function MyRequestsPage() {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [{ data: hrTickets }, { data: itTickets }, { data: onboarding }, { data: offboarding }, cases, slots] =
    await Promise.all([
      supabase
        .schema("hr")
        .from("tickets")
        .select("id, subject, status, created_at")
        .eq("person_id", personId ?? "")
        .order("created_at", { ascending: false }),
      supabase
        .schema("it")
        .from("tickets")
        .select("id, ticket_number, subject, status, created_at")
        .eq("requester_person_id", personId ?? "")
        .order("created_at", { ascending: false }),
      supabase
        .schema("it")
        .from("onboarding_offboarding")
        .select("id, request_number, status, created_at")
        .eq("kind", "Onboarding")
        .eq("person_id", personId ?? "")
        .order("created_at", { ascending: false }),
      supabase
        .schema("it")
        .from("onboarding_offboarding")
        .select("id, request_number, status, created_at")
        .eq("kind", "Offboarding")
        .eq("requested_by", personId ?? "")
        .order("created_at", { ascending: false }),
      // HR clearance flow (replaced the old IT self-offboarding). The person_id filter is needed:
      // hr.clearance.read_all holders can read everyone's cases.
      supabase
        .schema("hr")
        .from("clearance_cases")
        .select("id, case_number, status, last_working_date, created_at")
        .eq("person_id", personId ?? "")
        .order("created_at", { ascending: false }),
      supabase
        .schema("hr")
        .from("clearance_slots")
        .select("slot_key", { count: "exact", head: true })
        .eq("is_active", true),
    ]);

  const { data: clearanceCases, error: casesError } = cases;
  const { count: slotCount, error: slotsError } = slots;
  const caseIds = (clearanceCases ?? []).map((c) => c.id);
  const { data: signoffs, error: signoffsError } = caseIds.length
    ? await supabase.schema("hr").from("clearance_signoffs").select("case_id").in("case_id", caseIds)
    : { data: [], error: null };
  // Skipped parts need no signature, so they are left out of "x of y signed".
  const { data: skips, error: skipsError } = caseIds.length
    ? await supabase.schema("hr").from("clearance_skips").select("case_id").in("case_id", caseIds)
    : { data: [], error: null };
  const signedByCase = new Map<string, number>();
  for (const s of signoffs ?? []) signedByCase.set(s.case_id, (signedByCase.get(s.case_id) ?? 0) + 1);
  const skippedByCase = new Map<string, number>();
  for (const s of skips ?? []) skippedByCase.set(s.case_id, (skippedByCase.get(s.case_id) ?? 0) + 1);
  const clearanceError = casesError ?? slotsError ?? signoffsError ?? skipsError;

  const rows: Row[] = [
    ...(hrTickets ?? []).map((t) => ({
      key: `hr-${t.id}`,
      module: "HR" as const,
      label: t.subject,
      status: t.status,
      createdAt: t.created_at,
      href: "/hr/tickets",
    })),
    ...(itTickets ?? []).map((t) => ({
      key: `it-${t.id}`,
      module: "IT" as const,
      label: `${t.ticket_number} · ${t.subject}`,
      status: t.status,
      createdAt: t.created_at,
      href: `/it/my-tickets/${t.id}`,
    })),
    ...(onboarding ?? []).map((r) => ({
      key: `onb-${r.id}`,
      module: "Onboarding" as const,
      label: r.request_number,
      status: r.status,
      createdAt: r.created_at,
      href: "/it/my-onboarding",
    })),
    ...(offboarding ?? []).map((r) => ({
      key: `off-${r.id}`,
      module: "Offboarding" as const,
      label: r.request_number,
      status: r.status,
      createdAt: r.created_at,
      href: "/it/my-offboarding",
    })),
    ...(clearanceCases ?? []).map((c) => ({
      key: `clr-${c.id}`,
      module: "Offboarding" as const,
      label: `${c.case_number} · Offboarding clearance – last working date ${formatDay(c.last_working_date)}`,
      status: c.status,
      createdAt: c.created_at,
      href: `/requests/offboarding/${c.id}`,
      progress:
        c.status === "In Clearance"
          ? `${signedByCase.get(c.id) ?? 0} of ${(slotCount ?? 0) - (skippedByCase.get(c.id) ?? 0)} signed`
          : undefined,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="py-6">
      <PageHeader
        title="My Requests"
        description="Every ticket and request you've submitted, across HR and IT, in one place."
        action={
          <Link href="/requests/new" className={primaryButtonClass}>
            + New
          </Link>
        }
      />

      {clearanceError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Could not load your offboarding requests.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-400">You haven&apos;t submitted anything yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">Module</th>
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-5 py-2">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${MODULE_BADGE[r.module]}`}>
                      {r.module}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Link href={r.href} className="text-slate-900 hover:underline">
                      {r.label}
                    </Link>
                    {r.progress && <p className="text-xs text-slate-500">{r.progress}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill label={r.status} tone={STATUS_TONE[r.status] ?? "neutral"} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
