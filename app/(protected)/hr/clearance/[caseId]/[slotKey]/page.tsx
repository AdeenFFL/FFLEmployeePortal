import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import {
  STATUS_TONE,
  cleanSlotLabel,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  orderSlotsHrLast,
} from "../../../clearance-requests/clearance-view";
import {
  ANSWER_LABELS,
  FORM_TITLES,
  UUID_PATTERN,
  loadSignerSetup,
  mySlotsForCase,
} from "../../signer-work";
import { HR_DETAIL_GROUPS, formatHrDetail, toHrDetailsValues } from "../../hr-details-fields";
import { HrDetailsForm } from "./hr-details-form";
import { LineManagerPicker } from "./line-manager-picker";
import { HrWizard } from "./hr-wizard";
import { AssetReturns, type OpenAsset } from "./asset-returns";
import { SlotForm, type FormLine } from "./slot-form";

const DETAILS_NOT_SAVED =
  "HR details have not been saved yet. You can still sign, but page one will print with empty fields.";

const LIST_PATH = "/hr/clearance";
// Page-one line "Complete data received by line manager".
const DATA_RECEIVED_LINE = "p1.data_received";

const errorBox = "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700";
const card = "rounded-xl border border-slate-200 bg-white p-6 shadow-sm";
const cardTitle = "mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500";

// One case, one part (slot) of the clearance, for the person who signs that part. Only reachable
// for a slot this person actually holds for this case; anything else goes back to the inbox.
export default async function ClearanceSlotPage({
  params,
}: {
  params: Promise<{ caseId: string; slotKey: string }>;
}) {
  const { caseId, slotKey } = await params;
  if (!UUID_PATTERN.test(caseId)) redirect(LIST_PATH);

  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) redirect(LIST_PATH);

  const setup = await loadSignerSetup(supabase, personId);
  const slot = setup.slots.find((s) => s.slot_key === slotKey);
  if (!setup.error && !slot) redirect(LIST_PATH);

  const { data: c, error: caseError } = await hr
    .from("clearance_cases")
    .select(
      "id, case_number, person_id, employee_name, employee_code, designation, last_working_date, site_id, department_id, status, forwarded_at, cancelled_reason, contact_phone, contact_email, postal_address, reporting_manager_name, date_of_joining, line_manager_person_id, data_received_confirmed_at",
    )
    .eq("id", caseId)
    .maybeSingle();

  const backLink = (
    <Link href={LIST_PATH} className="text-sm text-blue-700 hover:underline">
      ← Back to Clearance to sign
    </Link>
  );

  if (setup.error || caseError || !slot) {
    return (
      <div className="flex flex-col gap-4 py-6">
        {backLink}
        <p className={errorBox}>Could not load this request. Please try again later.</p>
      </div>
    );
  }
  if (
    !c ||
    c.person_id === personId ||
    !mySlotsForCase(c, setup.signers, setup.slots).some((s) => s.slot_key === slotKey)
  ) {
    redirect(LIST_PATH);
  }

  const showAssets = slotKey === "it";
  const isHrSlot = slotKey === "hr";
  // Same list as ASSIGNABLE SLOTS in hr.assign_clearance_line.
  const canAssignLines = slotKey === "it";
  const [
    linesResult,
    responsesResult,
    signoffsResult,
    assetsResult,
    detailsResult,
    departmentName,
    skipsResult,
    onboardingResult,
    assignmentsResult,
    assetTasksResult,
  ] = await Promise.all([
    hr
      .from("clearance_lines")
      .select("id, line_key, description, auto_from_form, sort_order")
      .eq("slot_key", slotKey)
      .eq("is_active", true)
      .order("sort_order"),
    hr
      .from("clearance_responses")
      .select("line_id, outcome, remarks, responded_by, responded_at")
      .eq("case_id", caseId),
    hr
      .from("clearance_signoffs")
      .select("slot_key, signer_name, signer_designation, signed_at, remarks")
      .eq("case_id", caseId),
    // The IT signer of this case can list them without IT Inventory access (security definer).
    showAssets
      ? hr.rpc("clearance_list_open_assets", { p_case_id: caseId })
      : Promise.resolve({ data: [], error: null }),
    // Readable by the HR signer of this case (RLS on hr.clearance_hr_details).
    isHrSlot
      ? hr
          .from("clearance_hr_details")
          .select(
            "resignation_letter_date, resignation_effective_from, unserved_notice_days, overtime_single, overtime_double, overtime_triple, annual_leave_balance, other_outstanding, updated_at",
          )
          .eq("case_id", caseId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // clearance_list_units needs manage_signers or read_all: a signer without them just sees "—".
    isHrSlot && c.department_id
      ? hr
          .rpc("clearance_list_units")
          .then(({ data }) => (data ?? []).find((u) => u.id === c.department_id)?.name ?? null)
      : Promise.resolve(null),
    hr.from("clearance_skips").select("slot_key, reason").eq("case_id", caseId),
    // Suggestions from the onboarding request (talha_hr_0010). Until that function is live this
    // fails, and the page simply shows no suggestions.
    isHrSlot
      ? hr.rpc("clearance_onboarding_defaults", { p_case_id: caseId })
      : Promise.resolve({ data: [], error: null }),
    // Lines the IT Team Lead handed to IT staff (talha_hr_0011).
    canAssignLines
      ? hr
          .from("clearance_line_assignments")
          .select("line_id, assignee_person_id, assignee_name")
          .eq("case_id", caseId)
      : Promise.resolve({ data: [], error: null }),
    // Asset returns the IT Team Lead handed to IT staff (talha_hr_0012).
    showAssets
      ? hr
          .from("clearance_asset_tasks")
          .select("asset_assignment_id, assignee_person_id, assignee_name")
          .eq("case_id", caseId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const onboarding = onboardingResult.error ? null : (onboardingResult.data?.[0] ?? null);
  // Before talha_hr_0012 is live the table is missing: assets then work as before (no Assign).
  const assetTaskByAssignment = assetTasksResult.error
    ? null
    : new Map((assetTasksResult.data ?? []).map((t) => [t.asset_assignment_id, t]));
  // Before talha_hr_0011 is live the table is missing: the part then works as before (no Assign).
  // Only the IT part can hand lines out: other parts (HR, Admin, …) get no Assign button.
  const assignmentByLine = !canAssignLines || assignmentsResult.error
    ? null
    : new Map((assignmentsResult.data ?? []).map((a) => [a.line_id, a]));

  // Newest assignment first.
  const assets: OpenAsset[] = [...(assetsResult.data ?? [])]
    .sort((a, b) => b.assigned_date.localeCompare(a.assigned_date))
    .map((a) => ({
    assignment_id: a.assignment_id,
    asset_tag: a.asset_tag,
    asset_name: a.asset_name,
    serial_number: a.serial_number,
    assignedOn: formatDay(a.assigned_date),
    assigned_condition: a.assigned_condition,
    asset_status: a.asset_status,
    ...(assetTaskByAssignment
      ? {
          assignee: (() => {
            const t = assetTaskByAssignment.get(a.assignment_id);
            return t
              ? { personId: t.assignee_person_id, name: t.assignee_name, doneByThem: false }
              : null;
          })(),
        }
      : {}),
  }));

  const loadError =
    linesResult.error ??
    responsesResult.error ??
    signoffsResult.error ??
    detailsResult.error ??
    skipsResult.error;
  const responseByLine = new Map((responsesResult.data ?? []).map((r) => [r.line_id, r]));
  const signoffs = signoffsResult.data ?? [];
  const signoffBySlot = new Map(signoffs.map((s) => [s.slot_key, s]));
  const mySignoff = signoffBySlot.get(slotKey);
  const skipBySlot = new Map((skipsResult.data ?? []).map((s) => [s.slot_key, s]));
  const mySkip = skipBySlot.get(slotKey);
  const isOpen = c.status === "In Clearance";
  const labels = ANSWER_LABELS[slot.form_key];

  const lines: FormLine[] = (linesResult.data ?? []).map((l) => {
    const r = responseByLine.get(l.id);
    return {
      id: l.id,
      description: l.description,
      auto: l.auto_from_form !== null,
      autoFormTitle: l.auto_from_form ? FORM_TITLES[l.auto_from_form] : null,
      outcome: r?.outcome ?? null,
      remarks: r?.remarks ?? null,
      // While a line manager is chosen, only their confirmation answers this line.
      lockedNote:
        l.line_key === DATA_RECEIVED_LINE && c.line_manager_person_id
          ? "Fills in by itself when the line manager confirms."
          : null,
      ...(assignmentByLine && l.auto_from_form === null
        ? {
            assignee: (() => {
              const a = assignmentByLine.get(l.id);
              return a
                ? {
                    personId: a.assignee_person_id,
                    name: a.assignee_name,
                    doneByThem: Boolean(r?.outcome && r.responded_by === a.assignee_person_id),
                  }
                : null;
            })(),
          }
        : {}),
    };
  });
  // Answers saved by someone else (an assignee) since this form was drawn: draw it fresh so they
  // show. The signer's own saves do not change this, so their unsaved edits are kept.
  const othersLatestAnswer = (responsesResult.data ?? [])
    .filter((r) => r.responded_by && r.responded_by !== personId)
    .reduce((latest, r) => (r.responded_at && r.responded_at > latest ? r.responded_at : latest), "");

  // HR signs last: the other active parts still unsigned (skipped parts are not waited for).
  const waitingFor =
    slotKey === "hr"
      ? setup.slots
          .filter(
            (s) => s.slot_key !== "hr" && !signoffBySlot.has(s.slot_key) && !skipBySlot.has(s.slot_key),
          )
          .map((s) => cleanSlotLabel(s.label))
      : [];

  const savedDetails = detailsResult.data;
  const detailValues = toHrDetailsValues(c, savedDetails);
  const canEdit = isOpen && !mySignoff;
  // Same rule as setLineManager: saved details + a chosen manager = the manager is locked.
  const managerLocked = Boolean(savedDetails && c.line_manager_person_id);
  // No joining date on the case (the profile had none): suggest the onboarding one. It is a
  // prefill only; it is stored when HR saves the details.
  const joiningPrefill =
    !c.date_of_joining && onboarding?.joining_date ? onboarding.joining_date : null;
  const managerSuggestion = onboarding?.manager_name
    ? {
        personId: onboarding.manager_is_active ? onboarding.manager_person_id : null,
        name: onboarding.manager_name,
        detail:
          [onboarding.manager_employee_code, onboarding.manager_designation]
            .filter(Boolean)
            .join(" · ") || null,
      }
    : null;
  const fixedDetails: [string, string][] = [
    ["Employee P#", c.employee_code ?? "—"],
    ["Name", c.employee_name],
    ["Designation", c.designation ?? "—"],
    ["Department", departmentName ?? "—"],
  ];

  const today = karachiToday();
  const employee: [string, string][] = [
    ["Request", c.case_number],
    ["Name", c.employee_name],
    ["Employee code", c.employee_code ?? "—"],
    ["Designation", c.designation ?? "—"],
    [
      "Last working date",
      `${formatDay(c.last_working_date)} (${daysLeftText(c.last_working_date, today)})`,
    ],
    ["Forwarded", c.forwarded_at ? formatTimestamp(c.forwarded_at) : "—"],
  ];

  // The three sections of the HR part, shown either inside the wizard (an open HR part) or as
  // stacked cards (every other part, or a signed / closed HR part).
  const managerChosen = Boolean(c.line_manager_person_id);
  const useWizard = isHrSlot && canEdit && !loadError;

  const lineManagerContent = isHrSlot ? (
    <LineManagerPicker
      caseId={c.id}
      managerName={c.line_manager_person_id ? c.reporting_manager_name : null}
      confirmedOn={
        c.data_received_confirmed_at ? formatTimestamp(c.data_received_confirmed_at) : null
      }
      canChange={canEdit && !c.data_received_confirmed_at && !managerLocked}
      lockedNote={
        managerLocked && !c.data_received_confirmed_at
          ? "Locked: the HR details were saved with this line manager."
          : null
      }
      suggestion={managerSuggestion}
    />
  ) : null;

  const hrDetailsContent = isHrSlot ? (
    detailsResult.error ? (
      <p className={errorBox}>Could not load the HR details. Please try again later.</p>
    ) : (
      <div className="flex flex-col gap-6">
        <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-4">
          {fixedDetails.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        {canEdit ? (
          <HrDetailsForm
            caseId={c.id}
            initial={detailValues}
            prefill={joiningPrefill ? { date_of_joining: joiningPrefill } : undefined}
            prefillNote="Filled from the onboarding request. Check it, then save."
            lastSaved={
              savedDetails ? `Last saved ${formatTimestamp(savedDetails.updated_at)}` : null
            }
          />
        ) : (
          HR_DETAIL_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.title}
              </h3>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    <dt className="text-xs text-slate-500">{field.label}</dt>
                    <dd className="whitespace-pre-line text-sm text-slate-900">
                      {formatHrDetail(field, detailValues[field.key]) ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </div>
    )
  ) : null;

  const formContent = loadError ? (
    <p className={errorBox}>Could not load the form. Please try again later.</p>
  ) : mySignoff || mySkip || !isOpen ? (
    <div className="flex flex-col gap-4">
      {mySkip && !mySignoff && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This part was skipped for this request: {mySkip.reason}. Nothing to fill in or sign.
        </p>
      )}
      {mySignoff && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Signed by {mySignoff.signer_name}
          {mySignoff.signer_designation ? ` (${mySignoff.signer_designation})` : ""} on{" "}
          {formatTimestamp(mySignoff.signed_at)}. This part is locked.
          {mySignoff.remarks ? ` Remarks: ${mySignoff.remarks}` : ""}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-slate-500">This part has no checklist.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-100">
          {lines.map((l) => (
            <li key={l.id} className="py-3">
              <p className="text-sm font-medium text-slate-900">{l.description}</p>
              <p className="text-sm text-slate-700">
                {l.outcome ? labels[l.outcome] : "Not answered"}
                {l.remarks ? ` · ${l.remarks}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  ) : (
    <SlotForm
      // Choosing or clearing the line manager changes which lines are editable, and an
      // assignee's answer changes a line: start fresh.
      key={`${c.line_manager_person_id ?? "no-line-manager"}|${othersLatestAnswer}`}
      caseId={c.id}
      slotKey={slotKey}
      lines={lines}
      labels={labels}
      waitingFor={waitingFor}
      signHint={isHrSlot && !savedDetails ? DETAILS_NOT_SAVED : null}
      signBlocker={
        assets.length > 0
          ? `${assets.length} asset${assets.length === 1 ? " is" : "s are"} still assigned: return ${assets.length === 1 ? "it" : "them"} (or mark Lost) above.`
          : null
      }
    />
  );

  return (
    <div className="flex flex-col gap-6 py-6">
      {backLink}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">
          {c.case_number} · {cleanSlotLabel(slot.label)}
        </h1>
        <StatusPill label={c.status} tone={STATUS_TONE[c.status]} />
      </div>

      {c.status === "Cancelled" && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This request was cancelled. Reason: {c.cancelled_reason ?? "—"}
        </p>
      )}
      {c.status === "Completed" && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This request is closed: the clearance is complete.
        </p>
      )}

      {/* Employee, Signatures (and Assets on the IT part) side by side on wide screens. */}
      <div className={`grid gap-6 ${showAssets ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
      <section className={card}>
        <h2 className={cardTitle}>Employee</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
          {employee.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Signatures</h2>
        <ul className="flex flex-col gap-2">
          {orderSlotsHrLast(setup.slots).map((s) => {
            const so = signoffBySlot.get(s.slot_key);
            const skip = skipBySlot.get(s.slot_key);
            return (
              <li key={s.slot_key} className="flex flex-wrap justify-between gap-2 text-sm lg:flex-col lg:gap-0">
                <span className="font-medium text-slate-900">{cleanSlotLabel(s.label)}</span>
                <span className={so ? "text-green-700" : "text-slate-500"}>
                  {so
                    ? `Signed by ${so.signer_name}${so.signer_designation ? ` (${so.signer_designation})` : ""} on ${formatTimestamp(so.signed_at)}`
                    : skip
                      ? `Skipped: ${skip.reason}`
                      : "Waiting"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {showAssets && (
        <section className={card}>
          <h2 className={cardTitle}>Assets still assigned (from IT Inventory)</h2>
          {assetsResult.error ? (
            <p className={errorBox}>Could not load the assets. Please try again later.</p>
          ) : (
            <AssetReturns
              caseId={c.id}
              assets={assets}
              canReturn={isOpen && !mySignoff && !mySkip}
            />
          )}
          {assets.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Return each asset, or mark it Lost, before signing. This updates IT Inventory at once.
            </p>
          )}
        </section>
      )}
      </div>

      {useWizard ? (
        // An open HR part: Line manager → HR details → Checklist & sign, one step at a time.
        <section className={card}>
          <HrWizard
            initialStep={!managerChosen ? 0 : !savedDetails ? 1 : 2}
            steps={[
              {
                title: "Line manager",
                done: managerChosen,
                nextHint: "Choose the line manager first.",
                content: lineManagerContent,
              },
              {
                title: "HR details",
                done: managerChosen && Boolean(savedDetails),
                nextHint: "Save the HR details first.",
                content: hrDetailsContent,
              },
              {
                title: "Checklist & sign",
                done: false,
                nextHint: "",
                content: formContent,
              },
            ]}
          />
        </section>
      ) : (
        <>
          {/* The line manager comes first: the HR details can only be saved once one is chosen. */}
          {isHrSlot && (
            <section className={card}>
              <h2 className={cardTitle}>Line manager</h2>
              {lineManagerContent}
            </section>
          )}

          {isHrSlot && (
            <section className={card}>
              <h2 className={cardTitle}>HR details (page one)</h2>
              {hrDetailsContent}
            </section>
          )}

          <section className={card}>
            <h2 className={cardTitle}>{FORM_TITLES[slot.form_key]}</h2>
            {formContent}
          </section>
        </>
      )}
    </div>
  );
}
