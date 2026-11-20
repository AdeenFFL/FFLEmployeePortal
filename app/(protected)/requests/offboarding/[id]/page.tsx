import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { ClearanceTracker, MISSING_SETUP_WARNING } from "../../../hr/clearance/clearance-tracker";
import { formatDay, formatTimestamp, STATUS_TONE } from "../../../hr/resignations/clearance-view";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEXT_STEP: Record<string, string> = {
  Submitted:
    "HR will check your request and forward it for clearance. You will see each department's signature here.",
  "In Clearance":
    "Each department is checking what you need to return or settle. HR signs last, after all others.",
  Completed: "Your clearance is complete.",
  Cancelled:
    "This request was cancelled. If you still want to leave, submit a new request from your profile.",
};

// The employee's own offboarding clearance request (hr.clearance_cases), opened from My Requests.
// Filtered on person_id as well as id: hr.clearance.read_all holders can read everyone's cases
// through RLS, but this page only ever shows the viewer's own (HR uses /hr/resignations/[id]).
export default async function MyOffboardingRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) redirect("/requests");

  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [{ data: c, error }, { data: me }] = await Promise.all([
    supabase
      .schema("hr")
      .from("clearance_cases")
      .select(
        "id, case_number, employee_name, employee_code, designation, last_working_date, raised_via, status, employee_signed_at, forwarded_at, completed_at, cancelled_reason, created_at",
      )
      .eq("id", id)
      .eq("person_id", personId ?? "")
      .maybeSingle(),
    supabase
      .from("persons")
      .select("site_id, department_id")
      .eq("id", personId ?? "")
      .maybeSingle(),
  ]);

  const backLink = (
    <Link href="/requests" className="text-sm text-blue-700 hover:underline">
      ← Back to My Requests
    </Link>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4 py-6">
        {backLink}
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load this request. Please try again later.
        </p>
      </div>
    );
  }
  if (!c) redirect("/requests");

  const missingSetup = me ? !me.site_id || !me.department_id : false;
  const summary: [string, string][] = [
    ["Request", c.case_number],
    ["Name", c.employee_name],
    ["Employee code", c.employee_code ?? "—"],
    ["Designation", c.designation ?? "—"],
    ["Last working date", formatDay(c.last_working_date)],
    ["Submitted", formatTimestamp(c.employee_signed_at ?? c.created_at)],
    ["Forwarded", c.forwarded_at ? formatTimestamp(c.forwarded_at) : "—"],
    ["Completed", c.completed_at ? formatTimestamp(c.completed_at) : "—"],
  ];

  return (
    <div className="flex flex-col gap-6 py-6">
      {backLink}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{c.case_number}</h1>
        <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
      </div>

      {missingSetup && c.status === "Submitted" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {MISSING_SETUP_WARNING}
        </p>
      )}

      {c.status === "Cancelled" && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Reason: {c.cancelled_reason ?? "—"}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {summary.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          What happens next
        </h2>
        <p className="text-sm text-slate-700">{NEXT_STEP[c.status]}</p>
        {(c.status === "Submitted" || c.status === "In Clearance") && (
          <p className="mt-2 text-xs text-slate-500">
            Please also hand your signed resignation letter to HR. It is not uploaded here.
          </p>
        )}
      </section>

      {/* Hidden for a cancelled case: its "Completed: Waiting" step would be misleading. */}
      {c.status !== "Cancelled" && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Progress
          </h2>
          <ClearanceTracker clearanceCase={c} />
        </section>
      )}
    </div>
  );
}
