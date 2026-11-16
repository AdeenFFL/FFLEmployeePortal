import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { OffboardingForm } from "./offboarding-form";
import { getSignatureCount, MISSING_SETUP_WARNING } from "./clearance-tracker";
import { formatDay, STATUS_TONE } from "../resignations/clearance-view";

const TZ = "Asia/Karachi";

// "Today" and "one year from today" in Pakistan time (YYYY-MM-DD) for the date input — the same
// bounds hr.create_clearance_case_internal checks (self: today or later, at most 365 days ahead).
function karachiDateRange() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + 365);
  return { min: today, max: max.toISOString().slice(0, 10) };
}

// The employee's own Offboarding card on /profile: the submit form, or a short summary of the
// latest request with a link to its detail page (/requests/offboarding/[id], which has the full
// tracker). Renders nothing for someone who may not submit and has no request.
export async function OffboardingCard({
  personId,
  siteId,
  departmentId,
}: {
  personId: string;
  siteId: string | null;
  departmentId: string | null;
}) {
  const supabase = await createClient();
  const hr = supabase.schema("hr");

  const [{ data: canRequest }, { data: latest, error: caseError }] = await Promise.all([
    supabase.rpc("has_permission", { p_permission_key: "hr.clearance.request_self" }),
    hr
      .from("clearance_cases")
      .select(
        "id, case_number, status, last_working_date, raised_via, employee_signed_at, forwarded_at, completed_at, cancelled_reason, created_at",
      )
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!latest && !canRequest && !caseError) return null;

  const missingSetup = !siteId || !departmentId;
  const isTracked = latest && latest.status !== "Cancelled";

  const progress = latest && isTracked ? await getSignatureCount(latest.id) : null;

  const range = karachiDateRange();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Offboarding
      </h2>

      {caseError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load your offboarding request. Please try again later.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Only while it matters: before submitting, or while waiting to be forwarded. */}
          {missingSetup && ((!isTracked && canRequest) || latest?.status === "Submitted") && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {MISSING_SETUP_WARNING}
            </p>
          )}

          {latest && isTracked && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-sm text-slate-700">
                <span className="font-medium">{latest.case_number}</span>
                <StatusPill label={latest.status} tone={STATUS_TONE[latest.status]} />
              </p>
              <p className="text-sm text-slate-700">
                Last working date: {formatDay(latest.last_working_date)}
                {" · "}
                {latest.status === "Submitted"
                  ? "Waiting for HR to forward"
                  : progress
                    ? `Signatures: ${progress.signed} of ${progress.total}`
                    : "Signatures could not be loaded"}
              </p>
              <Link
                href={`/requests/offboarding/${latest.id}`}
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                View details →
              </Link>
            </div>
          )}

          {latest?.status === "Cancelled" && (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Your request {latest.case_number} was cancelled. Reason: {latest.cancelled_reason ?? "—"}
              {" · "}
              <Link
                href={`/requests/offboarding/${latest.id}`}
                className="font-medium text-blue-700 hover:underline"
              >
                View details
              </Link>
            </p>
          )}

          {!isTracked && canRequest && <OffboardingForm minDate={range.min} maxDate={range.max} />}
        </div>
      )}
    </div>
  );
}
