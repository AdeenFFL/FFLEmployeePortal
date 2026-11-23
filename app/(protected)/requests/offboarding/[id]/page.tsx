import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import {
  ClearanceTracker,
  MISSING_SETUP_WARNING,
} from "../../../hr/clearance/clearance-tracker";
import {
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  lastDayBadgeClass,
  STATUS_TONE,
} from "../../../hr/clearance-requests/clearance-view";

// Same look as the HR clearance screens: compact cards, small headers.
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const cardTitle =
  "mb-3 border-b border-slate-100 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// through RLS, but this page only ever shows the viewer's own (HR uses /hr/clearance-requests/[id]).
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

  // Round back button; the words are in the tooltip.
  const backLink = (
    <Link
      href="/requests"
      title="Back to My Requests"
      aria-label="Back to My Requests"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
    >
      ←
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
  // The strip's second row (name, code, designation and last day sit in its first row).
  const summary: [string, string][] = [
    ["Submitted", formatTimestamp(c.employee_signed_at ?? c.created_at)],
    ["Forwarded", c.forwarded_at ? formatTimestamp(c.forwarded_at) : "—"],
    ["Completed", c.completed_at ? formatTimestamp(c.completed_at) : "—"],
  ];
  const today = karachiToday();
  const initials = c.employee_name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string, i: number, all: string[]) =>
      i === 0 || i === all.length - 1 ? w[0] : "",
    )
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        {backLink}
        <h1 className="text-base font-semibold text-slate-900">
          {c.case_number}
        </h1>
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

      {/* One slim strip, as on the HR screens. */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800"
              aria-hidden="true"
            >
              {initials || "?"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {c.employee_name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {[c.employee_code, c.designation].filter(Boolean).join(" · ") ||
                  "—"}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${lastDayBadgeClass(c.last_working_date, today, c.status)}`}
            title="Last working date"
          >
            Last day {formatDay(c.last_working_date)} ·{" "}
            {daysLeftText(c.last_working_date, today)}
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-slate-100 pt-2 text-xs">
          {summary.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>What happens next</h2>
        <p className="text-sm text-slate-700">{NEXT_STEP[c.status]}</p>
        {(c.status === "Submitted" || c.status === "In Clearance") && (
          <p className="mt-2 text-xs text-slate-500">
            Please also hand your signed resignation letter to HR. It is not
            uploaded here.
          </p>
        )}
      </section>

      {/* Hidden for a cancelled case: its "Completed: Waiting" step would be misleading. */}
      {c.status !== "Cancelled" && (
        <section className={card}>
          <h2 className={cardTitle}>Progress</h2>
          <ClearanceTracker clearanceCase={c} />
        </section>
      )}
    </div>
  );
}
