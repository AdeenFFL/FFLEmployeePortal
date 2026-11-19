import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { listOpenAssignments } from "@/lib/it/assets";
import {
  STATUS_TONE,
  cleanSlotLabel,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
  orderSlotsHrLast,
} from "../../../resignations/clearance-view";
import {
  ANSWER_LABELS,
  FORM_TITLES,
  UUID_PATTERN,
  loadSignerSetup,
  mySlotsForCase,
} from "../../signer-work";
import { HR_DETAIL_GROUPS, formatHrDetail, toHrDetailsValues } from "../../hr-details-fields";
import { HrDetailsForm } from "./hr-details-form";
import { SlotForm, type FormLine } from "./slot-form";

const DETAILS_NOT_SAVED =
  "HR details have not been saved yet. You can still sign, but page one will print with empty fields.";

const LIST_PATH = "/hr/clearance";

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
      "id, case_number, person_id, employee_name, employee_code, designation, last_working_date, site_id, department_id, status, forwarded_at, cancelled_reason, contact_phone, contact_email, postal_address, reporting_manager_name, date_of_joining",
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
  const [
    linesResult,
    responsesResult,
    signoffsResult,
    canReadAssets,
    detailsResult,
    departmentName,
    skipsResult,
  ] = await Promise.all([
    hr
      .from("clearance_lines")
      .select("id, description, auto_from_form, sort_order")
      .eq("slot_key", slotKey)
      .eq("is_active", true)
      .order("sort_order"),
    hr.from("clearance_responses").select("line_id, outcome, remarks").eq("case_id", caseId),
    hr
      .from("clearance_signoffs")
      .select("slot_key, signer_name, signer_designation, signed_at, remarks")
      .eq("case_id", caseId),
    showAssets
      ? supabase
          .rpc("has_permission", { p_permission_key: "it.assets.read" })
          .then(({ data }) => Boolean(data))
      : Promise.resolve(false),
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
  ]);

  // Without it.assets.read the asset list comes back empty (RLS), which would wrongly read as
  // "no assets" — so it is only fetched for people who can see the register.
  let assets: Awaited<ReturnType<typeof listOpenAssignments>> = [];
  let assetsError = false;
  if (showAssets && canReadAssets) {
    try {
      assets = await listOpenAssignments(supabase, c.person_id);
    } catch {
      assetsError = true;
    }
  }

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
    };
  });

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

      <section className={card}>
        <h2 className={cardTitle}>Employee</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
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
              <li key={s.slot_key} className="flex flex-wrap justify-between gap-2 text-sm">
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
          {!canReadAssets ? (
            <p className="text-sm text-slate-500">
              You can&apos;t see the IT asset register. Check this employee&apos;s assets in IT
              Inventory or ask the IT team.
            </p>
          ) : assetsError ? (
            <p className={errorBox}>Could not load the assets.</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-slate-500">No assets are assigned to this employee.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {assets.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-900">
                    {a.assets?.asset_tag ?? "—"} · {a.assets?.asset_name ?? "—"}
                    {a.assets?.serial_number ? ` · S/N ${a.assets.serial_number}` : ""}
                  </span>
                  <span className="text-slate-500">Since {formatDay(a.assigned_date)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">For help only: it does not answer any line.</p>
        </section>
      )}

      {isHrSlot && (
        <section className={card}>
          <h2 className={cardTitle}>HR details (page one)</h2>
          {detailsResult.error ? (
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
          )}
        </section>
      )}

      <section className={card}>
        <h2 className={cardTitle}>{FORM_TITLES[slot.form_key]}</h2>
        {loadError ? (
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
            caseId={c.id}
            slotKey={slotKey}
            lines={lines}
            labels={labels}
            waitingFor={waitingFor}
            signHint={isHrSlot && !savedDetails ? DETAILS_NOT_SAVED : null}
          />
        )}
      </section>
    </div>
  );
}
