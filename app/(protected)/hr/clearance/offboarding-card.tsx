import { createClient } from "@/lib/supabase/server";
import { OffboardingForm } from "./offboarding-form";

const TZ = "Asia/Karachi";
const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
// A plain date (last_working_date) has no time zone: format it as-is, never shifted.
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatTimestamp(value: string) {
  return timestampFormat.format(new Date(value));
}

function formatDay(value: string) {
  return dayFormat.format(new Date(`${value}T00:00:00Z`));
}

// "Today" and "one year from today" in Pakistan time (YYYY-MM-DD) for the date input — the same
// bounds hr.create_clearance_case_internal checks (self: today or later, at most 365 days ahead).
function karachiDateRange() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + 365);
  return { min: today, max: max.toISOString().slice(0, 10) };
}

// "HR (page one)" -> "HR", "Department Head (page one)" -> "Department Head".
function cleanLabel(label: string) {
  return label.replace(/ \(page one\)$/, "");
}

type Step = { key: string; label: string; done: boolean; detail: string };

const MISSING_SETUP_WARNING =
  "Your site or department is not set in the portal. You can still submit, but HR cannot start your clearance until it is set. Please ask HR or the portal administrator to update your record.";

// The employee's own Offboarding card on /profile. Reads only what RLS already lets the employee
// see: their own clearance_cases rows, the slots, and the signatures on their own case (never
// the answers). Renders nothing for someone who may not submit and has no request.
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

  let steps: Step[] = [];
  if (latest && isTracked) {
    const [{ data: slots }, { data: signoffs }] = await Promise.all([
      hr
        .from("clearance_slots")
        .select("slot_key, label, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
      hr
        .from("clearance_signoffs")
        .select("slot_key, signer_name, signer_designation, signed_at")
        .eq("case_id", latest.id),
    ]);

    const signoffBySlot = new Map((signoffs ?? []).map((s) => [s.slot_key, s]));
    // HR signs last (the database enforces it), so it is shown last, just before Completed.
    const orderedSlots = [
      ...(slots ?? []).filter((s) => s.slot_key !== "hr"),
      ...(slots ?? []).filter((s) => s.slot_key === "hr"),
    ];

    const submittedAt = latest.employee_signed_at ?? latest.created_at;
    steps = [
      {
        key: "submitted",
        label: "Submitted",
        done: true,
        detail:
          latest.raised_via === "self"
            ? `Submitted on ${formatTimestamp(submittedAt)} (signed electronically)`
            : `Started by HR on ${formatTimestamp(latest.created_at)}`,
      },
      {
        key: "forwarded",
        label: "Forwarded (In Clearance)",
        done: latest.forwarded_at !== null,
        detail: latest.forwarded_at ? `Forwarded on ${formatTimestamp(latest.forwarded_at)}` : "Waiting",
      },
      ...orderedSlots.map((slot) => {
        const signoff = signoffBySlot.get(slot.slot_key);
        const signer = signoff
          ? signoff.signer_designation
            ? `${signoff.signer_name} (${signoff.signer_designation})`
            : signoff.signer_name
          : null;
        return {
          key: slot.slot_key,
          label: cleanLabel(slot.label),
          done: Boolean(signoff),
          detail: signoff ? `Signed by ${signer} on ${formatTimestamp(signoff.signed_at)}` : "Waiting",
        };
      }),
      {
        key: "completed",
        label: "Completed",
        done: latest.status === "Completed",
        detail: latest.completed_at ? `Completed on ${formatTimestamp(latest.completed_at)}` : "Waiting",
      },
    ];
  }

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
            <>
              <p className="text-sm text-slate-700">
                <span className="font-medium">{latest.case_number}</span>
                {" · "}Last working date: {formatDay(latest.last_working_date)}
              </p>
              <ol className="flex flex-col gap-3">
                {steps.map((step) => (
                  <li key={step.key} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                        step.done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                      }`}
                      aria-hidden
                    >
                      {step.done ? "✓" : "○"}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{step.label}</p>
                      <p className="text-xs text-slate-500">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {latest?.status === "Cancelled" && (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Your request {latest.case_number} was cancelled. Reason: {latest.cancelled_reason ?? "—"}
            </p>
          )}

          {!isTracked && canRequest && <OffboardingForm minDate={range.min} maxDate={range.max} />}
        </div>
      )}
    </div>
  );
}
