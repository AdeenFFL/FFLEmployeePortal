import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, fetchPersonNames } from "@/lib/it/ticket-data";
import { formatDateTime } from "@/lib/it/tickets";
import { RequestDetails } from "../../../it/onboarding/_components/request-details";
import { cardClass, secondaryButtonClass, Timeline } from "../../../it/_components/ticket-ui";

// HR's read-only view of one onboarding / offboarding request: what was raised, how far IT has
// got, and the activity. No checklist and no IT actions — those are on /it/onboarding/[id].
// IT's internal work notes are left out of the activity.
export default async function HrOnboardingRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = checked(
    await supabase.schema("it").from("onboarding_offboarding").select("*").eq("id", id).maybeSingle(),
  );
  if (!request) notFound();

  const [{ data: items }, { data: updates }, orgUnits] = await Promise.all([
    supabase.schema("it").from("checklist_items").select("status").eq("request_id", id),
    supabase
      .schema("it")
      .from("onboarding_updates")
      .select("*")
      .eq("request_id", id)
      .eq("is_internal", false)
      .order("created_at"),
    fetchOrgUnits(supabase),
  ]);
  const names = await fetchPersonNames(supabase, [
    request.requested_by,
    request.it_executive_person_id,
    ...(updates ?? []).map((u) => u.author_person_id),
  ]);

  const total = (items ?? []).length;
  const done = (items ?? []).filter((i) => i.status === "Completed" || i.status === "Not Applicable").length;
  const raisedBy = request.requested_by ? (names.get(request.requested_by) ?? "—") : "—";
  const itExecutive = request.it_executive_person_id ? names.get(request.it_executive_person_id) : null;

  return (
    <div className="py-6">
      <PageHeader
        title={`${request.request_number} · ${request.employee_name}`}
        description={`${request.kind} · raised by ${raisedBy} on ${formatDateTime(request.created_at)}`}
        action={
          <Link href="/hr/onboarding" className={secondaryButtonClass}>
            Back to list
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <RequestDetails request={request} nameById={orgUnits.nameById} />

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Activity</h2>
            <Timeline updates={updates ?? []} names={names} />
          </section>
        </div>

        <div className="space-y-6">
          <section className={`${cardClass} p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">IT progress</h2>
            <p className="text-2xl font-semibold text-slate-900">
              {done}/{total}
              <span className="ml-1 text-sm font-normal text-slate-500">tasks done</span>
            </p>
            {total > 0 && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((done / total) * 100)}%` }} />
              </div>
            )}
            <p className="mt-3 text-sm text-slate-600">
              IT Executive: {itExecutive ?? <span className="text-slate-400">not picked up yet</span>}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
