import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { CaseActions, RefreshOrgButton, SlotSkipControl } from "./case-actions";
import {
  STATUS_TONE,
  caseReadiness,
  cleanSlotLabel,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  orderSlotsHrLast,
  signersFor,
  type SlotInfo,
} from "../clearance-view";

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

export default async function ResignationDetailPage({
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
      .select("id, form_key, description, auto_from_form, sort_order, is_active")
      .order("sort_order"),
    hr.from("clearance_responses").select("line_id, outcome, remarks").eq("case_id", id),
    hr
      .from("clearance_signoffs")
      .select("slot_key, signer_name, signer_designation, signed_at, remarks")
      .eq("case_id", id),
    hr.rpc("clearance_list_units"),
    hr.rpc("clearance_list_signers"),
    supabase.rpc("has_permission", { p_permission_key: "hr.clearance.forward" }),
    hr.from("clearance_skips").select("slot_key, reason, skipped_at").eq("case_id", id),
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
  const signoffBySlot = new Map((signoffsResult.data ?? []).map((s) => [s.slot_key, s]));
  const responseByLine = new Map((responsesResult.data ?? []).map((r) => [r.line_id, r]));
  const skipBySlot = new Map((skipsResult.data ?? []).map((s) => [s.slot_key, s]));
  const today = karachiToday();

  const siteName = c.site_id ? (unitName.get(c.site_id) ?? "(inactive site)") : null;
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
    Boolean(canForward) && (c.status === "Submitted" || c.status === "In Clearance");
  const showRefresh =
    showReadiness && Boolean(canForward) && (readiness.missingSite || readiness.missingDepartment);

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
      detail: c.forwarded_at ? `Forwarded on ${formatTimestamp(c.forwarded_at)}` : "Waiting",
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
            ? { undoBlockedReason: expected.length === 0 ? "Set a signer for this part first" : null }
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
      detail: c.completed_at ? `Completed on ${formatTimestamp(c.completed_at)}` : "Waiting",
    },
  ];

  // Active lines, plus any retired line that was already answered on this case.
  const lines = (linesResult.data ?? []).filter(
    (l) => l.is_active || responseByLine.get(l.id)?.outcome,
  );

  const snapshot: [string, string | null][] = [
    ["Employee code", c.employee_code],
    ["Designation", c.designation],
    ["Site", siteName],
    ["Department", deptName],
    ["Date of joining", c.date_of_joining ? formatDay(c.date_of_joining) : null],
    [
      "Last working date",
      `${formatDay(c.last_working_date)} (${daysLeftText(c.last_working_date, today)})`,
    ],
    ["Phone", c.contact_phone],
    ["Email", c.contact_email],
    ["Postal address", c.postal_address],
    ["Reporting manager", c.reporting_manager_name],
  ];

  return (
    <div className="py-6">
      <Link href="/hr/resignations" className="text-sm text-slate-500 hover:text-slate-700">
        ← Resignations
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{c.employee_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{c.case_number}</span>
            <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
            <span>Raised by {c.raised_via === "self" ? "Employee" : "HR"}</span>
          </div>
        </div>
        <CaseActions
          caseId={c.id}
          status={c.status}
          canForward={Boolean(canForward)}
          ready={readiness.ready}
        />
      </div>

      {loadError && (
        <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</p>
      )}

      {c.status === "Cancelled" && (
        <p className="mb-6 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700">
          Cancelled. Reason: {c.cancelled_reason ?? "—"}
        </p>
      )}

      {showReadiness &&
        (readiness.ready ? (
          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-medium">Ready to forward?</p>
            <p>Ready. All signers are set for this site and department.</p>
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Ready to forward? Not yet:</p>
            <ul className="list-disc pl-5">
              {readiness.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {readiness.slotsWithoutSigner.length > 0 && (
              <p className="mt-1">
                Set them on the{" "}
                <Link href="/hr/admin/clearance-signers" className="font-medium underline">
                  Clearance Signers
                </Link>{" "}
                page, or skip a part for this request under Progress below.
              </p>
            )}
            {(readiness.missingSite || readiness.missingDepartment) && (
              <p className="mt-1">
                Ask Admin to set it in Admin &gt; Users, then update this request from the profile.
              </p>
            )}
            {showRefresh && <RefreshOrgButton caseId={c.id} />}
          </div>
        ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Employee
          </h2>
          <p className="mb-4 text-xs text-slate-400">Snapshot taken when the request was submitted.</p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            {snapshot.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-slate-900">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Progress
          </h2>
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    step.done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                  }`}
                  aria-hidden
                >
                  {step.done ? "✓" : step.skipped ? "–" : "○"}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{step.label}</p>
                  <p className={`text-xs ${step.missing ? "text-red-600" : "text-slate-500"}`}>
                    {step.detail}
                  </p>
                  {step.skip && (
                    <SlotSkipControl
                      caseId={c.id}
                      slotKey={step.key}
                      skipped={Boolean(step.skipped)}
                      undoBlockedReason={step.skip.undoBlockedReason}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {FORMS.map((form) => {
          const formLines = lines.filter((l) => l.form_key === form.key);
          if (formLines.length === 0) return null;
          return (
            <div key={form.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <h2 className="border-b border-slate-100 px-6 py-3 text-sm font-semibold text-slate-900">
                {form.title}
              </h2>
              <ul className="divide-y divide-slate-100">
                {formLines.map((line) => {
                  const response = responseByLine.get(line.id);
                  const outcome = response?.outcome ?? null;
                  return (
                    <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">{line.description}</p>
                        {line.auto_from_form && (
                          <p className="text-xs text-slate-400">(fills in when the form is signed)</p>
                        )}
                        {response?.remarks && (
                          <p className="text-xs text-slate-500">Remarks: {response.remarks}</p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 text-sm font-medium ${
                          outcome === "Yes"
                            ? "text-green-700"
                            : outcome === "No"
                              ? "text-red-600"
                              : outcome === "N/A"
                                ? "text-slate-600"
                                : "text-slate-400"
                        }`}
                      >
                        {outcome ?? "Not answered yet"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
