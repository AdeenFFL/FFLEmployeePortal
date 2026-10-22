import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

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
  Resolved: "positive",
  Completed: "positive",
  Closed: "neutral",
  Cancelled: "neutral",
};

export default async function MyRequestsPage() {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [{ data: hrTickets }, { data: itTickets }, { data: onboarding }, { data: offboarding }] =
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
    ]);

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
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="py-6">
      <PageHeader
        title="My Requests"
        description="Every ticket and request you've submitted, across HR and IT, in one place."
      />

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
