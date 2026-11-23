import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { CaseActions, RefreshOrgButton, SlotSkipControl } from "./case-actions";
import { HorizontalSteps } from "./horizontal-steps";
import {
  STATUS_TONE,
  caseReadiness,
  progressStepStates,
  cleanSlotLabel,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  orderSlotsHrLast,
  overdueDays,
  signersFor,
  type SlotInfo,
} from "../clearance-view";
import { ANSWER_LABELS } from "../../clearance/signer-work";
import { LineText } from "../../clearance/[caseId]/[slotKey]/slot-form";
import {
  LineTag,
  RemarksButton,
} from "../../clearance/[caseId]/[slotKey]/remarks-button";

// Same look as the part page (hr/clearance/[caseId]/[slotKey]): compact cards, small headers.
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const cardTitle =
  "mb-3 border-b border-slate-100 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500";

const FORMS = [
  { key: "page_one", title: "Page one (HR checklist)" },
  { key: "admin", title: "Administration / Sales Operation / Area Office" },
  { key: "accounts", title: "Accounts" },
  { key: "it", title: "Information Technology" },
] as const;

type Step = {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  missing?: boolean;
  skipped?: boolean;
  // Set on a part the HRBP may skip or un-skip (not signed, not HR, request still open).
  skip?: { undoBlockedReason: string | null };
};

export default async function ClearanceRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const hr = supabase.schema("hr");

  const [
    { data: c },
    slotsResult,
    linesResult,
    responsesResult,
    signoffsResult,
    unitsResult,
    signersResult,
    { data: canForward },
    skipsResult,
    missingResult,
  ] = await Promise.all([
    hr.from("clearance_cases").select("*").eq("id", id).maybeSingle(),
    hr
      .from("clearance_slots")
      .select("slot_key, label, scope")
      .eq("is_active", true)
      .order("sort_order"),
    hr
      .from("clearance_lines")
      .select(
        "id, form_key, description, auto_from_form, sort_order, is_active",
      )
      .order("sort_order"),
    hr
      .from("clearance_responses")
      .select("line_id, outcome, remarks")
      .eq("case_id", id),
    hr
      .from("clearance_signoffs")
      .select("slot_key, signer_name, signer_designation, signed_at, remarks")
      .eq("case_id", id),
    hr.rpc("clearance_list_units"),
    hr.rpc("clearance_list_signers"),
    supabase.rpc("has_permission", {
      p_permission_key: "hr.clearance.forward",
    }),
    hr
      .from("clearance_skips")
      .select("slot_key, reason, skipped_at")
      .eq("case_id", id),
    // Parts with no signer that are not skipped: the same list Forward checks.
    hr.rpc("clearance_missing_for_case", { p_case_id: id }),
  ]);

  // A malformed id, a case this user can't see, or one that doesn't exist all land here.
  if (!c) notFound();

  const loadError =
    slotsResult.error ??
    linesResult.error ??
    responsesResult.error ??
    signoffsResult.error ??
    unitsResult.error ??
    signersResult.error ??
    skipsResult.error ??
    missingResult.error;

  const slots: SlotInfo[] = slotsResult.data ?? [];
  const signers = signersResult.data ?? [];
  const unitName = new Map((unitsResult.data ?? []).map((u) => [u.id, u.name]));
  const signoffBySlot = new Map(
    (signoffsResult.data ?? []).map((s) => [s.slot_key, s]),
  );
  const responseByLine = new Map(
    (responsesResult.data ?? []).map((r) => [r.line_id, r]),
  );
  const skipBySlot = new Map(
    (skipsResult.data ?? []).map((s) => [s.slot_key, s]),
  );
  const today = karachiToday();

  const siteName = c.site_id
    ? (unitName.get(c.site_id) ?? "(inactive site)")
    : null;
  const deptName = c.department_id
    ? (unitName.get(c.department_id) ?? "(inactive department)")
    : null;

  const readiness = caseReadiness(
    c.site_id,
    c.department_id,
    slots,
    missingResult.data ?? [],
    new Set(skipBySlot.keys()),
  );
  const showReadiness = c.status === "Submitted";
  const canSkip =
    Boolean(canForward) &&
    (c.status === "Submitted" || c.status === "In Clearance");
  const showRefresh =
    showReadiness &&
    Boolean(canForward) &&
    (readiness.missingSite || readiness.missingDepartment);

  const submittedAt = c.employee_signed_at ?? c.created_at;
  const steps: Step[] = [
    {
      key: "submitted",
      label: "Submitted",
      done: true,
      detail:
        c.raised_via === "self"
          ? `Submitted by the employee on ${formatTimestamp(submittedAt)} (signed electronically)`
          : `Started by HR on ${formatTimestamp(c.created_at)}`,
    },
    {
      key: "forwarded",
      label: "Forwarded (In Clearance)",
      done: c.forwarded_at !== null,
      detail: c.forwarded_at
        ? `Forwarded on ${formatTimestamp(c.forwarded_at)}`
        : "Waiting",
    },
    ...orderSlotsHrLast(slots).map((slot): Step => {
      const signoff = signoffBySlot.get(slot.slot_key);
      if (signoff) {
        const who = signoff.signer_designation
          ? `${signoff.signer_name} (${signoff.signer_designation})`
          : signoff.signer_name;
        return {
          key: slot.slot_key,
          label: cleanSlotLabel(slot.label),
          done: true,
          detail: `Signed by ${who} on ${formatTimestamp(signoff.signed_at)}${
            signoff.remarks ? ` · “${signoff.remarks}”` : ""
          }`,
        };
      }
      const expected = signersFor(signers, slot, c.site_id, c.department_id);
      const skippable = canSkip && slot.slot_key !== "hr";
      const skip = skipBySlot.get(slot.slot_key);
      if (skip) {
        return {
          key: slot.slot_key,
          label: cleanSlotLabel(slot.label),
          done: false,
          skipped: true,
          detail: `Skipped: ${skip.reason} (${formatTimestamp(skip.skipped_at)})`,
          skip: skippable
            ? {
                undoBlockedReason:
                  expected.length === 0
                    ? "Set a signer for this part first"
                    : null,
              }
            : undefined,
        };
      }
      const primary = expected.find((g) => g.is_primary) ?? expected[0];
      const backups = expected.length - 1;
      return {
        key: slot.slot_key,
        label: cleanSlotLabel(slot.label),
        done: false,
        missing: expected.length === 0,
        detail: primary
          ? `Waiting. Expected: ${primary.full_name}${backups > 0 ? ` (+${backups} backup)` : ""}`
          : "Waiting. No signer set",
        skip: skippable ? { undoBlockedReason: null } : undefined,
      };
    }),
    {
      key: "completed",
      label: "Completed",
      done: c.status === "Completed",
      detail: c.completed_at
        ? `Completed on ${formatTimestamp(c.completed_at)}`
        : "Waiting",
    },
  ];

  const stepStates = progressStepStates(steps, c.status);
  // Days since the forward, once past the reminder gap (else null).
  const overdue = overdueDays(c.forwarded_at, today);

  // Active lines, plus any retired line that was already answered on this case.
  const lines = (linesResult.data ?? []).filter(
    (l) => l.is_active || responseByLine.get(l.id)?.outcome,
  );

  // The employee strip (same look as the part page): name, code · designation and the last
  // working day as a coloured badge (green > 7 days left, amber 0–7, red once passed; grey when
  // the request is closed); the other details in one wrapping row under it.
  const snapshot: [string, string | null][] = [
    ["Site", siteName],
    ["Department", deptName],
    ["Joined", c.date_of_joining ? formatDay(c.date_of_joining) : null],
    ["Reporting manager", c.reporting_manager_name],
    ["Phone", c.contact_phone],
    ["Email", c.contact_email],
    ["Address", c.postal_address],
  ];
  const daysLeft = Math.round(
    (Date.parse(`${c.last_working_date}T00:00:00Z`) -
      Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  const caseClosed = c.status === "Completed" || c.status === "Cancelled";
  const lastDayTone = caseClosed
    ? "bg-slate-100 text-slate-700 ring-slate-200"
    : daysLeft < 0
      ? "bg-red-50 text-red-700 ring-red-200"
      : daysLeft <= 7
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-green-50 text-green-700 ring-green-200";
  const employeeInitials = c.employee_name
    .trim()
    .split(/s+/)
    .filter(Boolean)
    .map((w: string, i: number, all: string[]) =>
      i === 0 || i === all.length - 1 ? w[0] : "",
    )
    .join("")
    .toUpperCase();

  return (
    <div className="py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Round back button (words in the tooltip) beside a small title. */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            href="/hr/clearance-requests"
            title="Back to Clearance Requests"
            aria-label="Back to Clearance Requests"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
          >
            ←
          </Link>
          <h1 className="text-base font-semibold text-slate-900">
            {c.case_number} · {c.employee_name}
          </h1>
          <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
          <span className="text-xs text-slate-500">
            Raised by {c.raised_via === "self" ? "Employee" : "HR"}
          </span>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href={`/print/clearance/${c.id}`}
            target="_blank"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Print form
          </Link>
          <CaseActions
            caseId={c.id}
            status={c.status}
            canForward={Boolean(canForward)}
            ready={readiness.ready}
          />
        </div>
      </div>

      {loadError && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError.message}
        </p>
      )}

      {c.status === "Cancelled" && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
          Cancelled. Reason: {c.cancelled_reason ?? "—"}
        </p>
      )}

      {showReadiness &&
        (readiness.ready ? (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-medium">Ready to forward?</p>
            {readiness.autoSkipped.length > 0 ? (
              <p>
                Ready. These parts have no signer for this site / department and
                will be skipped automatically when you forward:{" "}
                {readiness.autoSkipped.join(", ")}.
              </p>
            ) : (
              <p>Ready. All signers are set for this site and department.</p>
            )}
            <p className="mt-1 text-xs">
              Forwarding emails every signer of the parts that are not skipped.
            </p>
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Ready to forward? Not yet:</p>
            <ul className="list-disc pl-5">
              {readiness.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {readiness.slotsWithoutSigner.length > 0 && (
              <p className="mt-1">
                Set them on the{" "}
                <Link
                  href="/hr/admin/clearance-signers"
                  className="font-medium underline"
                >
                  Clearance Signers
                </Link>{" "}
                page.
              </p>
            )}
            {readiness.autoSkipped.length > 0 && (
              <p className="mt-1">
                These parts have no signer and will be skipped automatically
                when you forward: {readiness.autoSkipped.join(", ")}.
              </p>
            )}
            {(readiness.missingSite || readiness.missingDepartment) && (
              <p className="mt-1">
                Ask Admin to set it in Admin &gt; Users, then update this
                request from the profile.
              </p>
            )}
            {showRefresh && <RefreshOrgButton caseId={c.id} />}
          </div>
        ))}

      {/* The employee as one slim strip, then Progress full width. */}
      <section className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800"
              aria-hidden="true"
            >
              {employeeInitials || "?"}
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
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${lastDayTone}`}
            title="Last working date"
          >
            Last day {formatDay(c.last_working_date)} ·{" "}
            {daysLeftText(c.last_working_date, today)}
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-slate-100 pt-2 text-xs">
          {snapshot.map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline gap-1.5">
              <dt className="text-slate-500">{label}</dt>
              <dd
                className="max-w-xs truncate font-medium text-slate-800"
                title={value ?? undefined}
              >
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div>
        <div className={card}>
          <h2 className={cardTitle}>Progress</h2>
          {/* One row of steps (little height); skip / undo sit under each part. */}
          <HorizontalSteps
            steps={steps.map((step, i) => ({
              id: step.key,
              label: step.label,
              state: stepStates[i],
              meta: step.missing
                ? `⚠ ${step.detail}`
                : stepStates[i] === "active" &&
                    c.status === "In Clearance" &&
                    overdue !== null
                  ? `⏰ Overdue · ${overdue} days`
                  : step.detail,
              warn:
                step.missing ||
                (stepStates[i] === "active" &&
                  c.status === "In Clearance" &&
                  overdue !== null),
              extra: step.skip ? (
                <SlotSkipControl
                  caseId={c.id}
                  slotKey={step.key}
                  skipped={Boolean(step.skipped)}
                  undoBlockedReason={step.skip.undoBlockedReason}
                />
              ) : undefined,
            }))}
          />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {FORMS.map((form) => {
          const formLines = lines.filter((l) => l.form_key === form.key);
          if (formLines.length === 0) return null;
          const labels = ANSWER_LABELS[form.key];
          const answered = formLines.filter(
            (l) => responseByLine.get(l.id)?.outcome,
          ).length;
          const complete = answered === formLines.length;
          return (
            // A finished form folds into one line ("✓ 5/5"); click to open it. Forms with open
            // lines stay open.
            <details
              key={form.key}
              className={`${card} group`}
              open={!complete}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {form.title}
                </h2>
                <span className="flex items-center gap-2">
                  <LineTag tone={complete ? "done" : "plain"}>
                    {complete ? "✓ " : ""}
                    {answered}/{formLines.length}
                  </LineTag>
                  <span
                    className="text-slate-400 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </span>
              </summary>
              <div className="mt-3 border-t border-slate-100 pt-1">
                {/* One row per line (as on the part page): text and hint, then the answer as a tag
                  (or where it is waiting) and the remark behind 💬. */}
                <ul className="divide-y divide-slate-100">
                  {formLines.map((line) => {
                    const response = responseByLine.get(line.id);
                    const outcome = (response?.outcome ?? null) as
                      "Yes" | "No" | "N/A" | null;
                    return (
                      <li
                        key={line.id}
                        className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2 py-2.5 hover:bg-slate-50"
                      >
                        <LineText description={line.description} />
                        <div className="flex flex-wrap items-center gap-2">
                          {outcome ? (
                            <LineTag
                              tone={
                                outcome === "No"
                                  ? "no"
                                  : outcome === "N/A"
                                    ? "plain"
                                    : "done"
                              }
                            >
                              {outcome === "Yes"
                                ? `✓ ${labels.Yes}`
                                : labels[outcome]}
                            </LineTag>
                          ) : line.auto_from_form ? (
                            <LineTag
                              tone="waiting"
                              title="Fills in by itself when that form is signed."
                            >
                              Waiting: sign-off
                            </LineTag>
                          ) : (
                            <LineTag tone="plain">Not answered</LineTag>
                          )}
                          <RemarksButton
                            value={response?.remarks ?? ""}
                            label={line.description}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
