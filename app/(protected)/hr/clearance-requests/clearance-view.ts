// Display helpers shared by the HRBP inbox list, detail page and start panel. Plain functions —
// no data fetching — so the client start panel can use readinessProblems() too.

export const CASE_STATUSES = ["Submitted", "In Clearance", "Completed", "Cancelled"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const STATUS_TONE: Record<CaseStatus, "info" | "warning" | "positive" | "neutral"> = {
  Submitted: "info",
  "In Clearance": "warning",
  Completed: "positive",
  Cancelled: "neutral",
};

export type SlotInfo = { slot_key: string; label: string; scope: "site" | "department" };
export type SignerScope = { slot_key: string; site_id: string | null; department_id: string | null };

const TZ = "Asia/Karachi";
const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
// A plain date (last_working_date, date_of_joining) has no time zone: format it as-is.
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatTimestamp(value: string) {
  return timestampFormat.format(new Date(value));
}

export function formatDay(value: string) {
  return dayFormat.format(new Date(`${value}T00:00:00Z`));
}

// Today's date in Pakistan time (YYYY-MM-DD) — what the database calls "today". Reads the clock,
// so call it once per request in a Server Component and pass the result down.
export function karachiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysLeftText(lastWorkingDay: string, today: string) {
  const diff = Math.round(
    (Date.parse(`${lastWorkingDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1) return `in ${diff} days`;
  if (diff === -1) return "yesterday";
  return `${-diff} days ago`;
}

// The coloured last-working-day badge (list, request page, part page, employee page): green with
// more than 7 days left, amber 0–7, red once passed; grey when the request is closed.
export function lastDayBadgeClass(lastWorkingDay: string, today: string, status: string) {
  if (status === "Completed" || status === "Cancelled") return "bg-slate-100 text-slate-700 ring-slate-200";
  const diff = Math.round(
    (Date.parse(`${lastWorkingDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diff < 0) return "bg-red-50 text-red-700 ring-red-200";
  if (diff <= 7) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-green-50 text-green-700 ring-green-200";
}

// "HR (page one)" -> "HR", "Department Head (page one)" -> "Department Head".
export function cleanSlotLabel(label: string) {
  return label.replace(/ \(page one\)$/, "");
}

// HR signs last (the database enforces it), so it is shown last.
export function orderSlotsHrLast<T extends { slot_key: string }>(slots: T[]) {
  return [...slots.filter((s) => s.slot_key !== "hr"), ...slots.filter((s) => s.slot_key === "hr")];
}

type SlotKeyed = { slot_key: string };

// One part of a case: signed, skipped for this request (hr.clearance_skips), or still waiting.
export function slotState(slotKey: string, signoffs: SlotKeyed[], skips: SlotKeyed[]) {
  if (signoffs.some((s) => s.slot_key === slotKey)) return "signed" as const;
  if (skips.some((s) => s.slot_key === slotKey)) return "skipped" as const;
  return "waiting" as const;
}

// "x of y signed": skipped parts need no signature, so they are left out of both numbers.
export function signatureProgress(slots: SlotKeyed[], signoffs: SlotKeyed[], skips: SlotKeyed[]) {
  const skipped = new Set(skips.map((s) => s.slot_key));
  const signed = new Set(signoffs.map((s) => s.slot_key));
  const counted = slots.filter((s) => !skipped.has(s.slot_key));
  return { signed: counted.filter((s) => signed.has(s.slot_key)).length, total: counted.length };
}

export function signersFor<T extends SignerScope>(
  signers: T[],
  slot: SlotInfo,
  siteId: string | null,
  departmentId: string | null,
) {
  return signers.filter((g) =>
    g.slot_key === slot.slot_key &&
    (slot.scope === "site" ? siteId !== null && g.site_id === siteId : departmentId !== null && g.department_id === departmentId),
  );
}

// The same three checks as hr.clearance_check_ready (which forward / raise run), but listing every
// problem instead of stopping at the first. A scope whose site/department is missing is reported
// once as "no site"/"no department", not again as every slot without a signer.
export function readinessProblems(
  siteId: string | null,
  departmentId: string | null,
  slots: SlotInfo[],
  signers: SignerScope[],
) {
  const hasDepartmentSlot = slots.some((s) => s.scope === "department");
  const missingSite = siteId === null;
  const missingDepartment = departmentId === null && hasDepartmentSlot;
  const slotsWithoutSigner = slots
    .filter((s) => (s.scope === "site" ? !missingSite : !missingDepartment))
    .filter((s) => signersFor(signers, s, siteId, departmentId).length === 0)
    .map((s) => cleanSlotLabel(s.label));

  const messages: string[] = [];
  if (missingSite) messages.push("No site is set for this employee.");
  if (missingDepartment) messages.push("No department is set for this employee.");
  if (slotsWithoutSigner.length > 0) messages.push(`No signer for: ${slotsWithoutSigner.join(", ")}.`);

  return { missingSite, missingDepartment, slotsWithoutSigner, messages, ready: messages.length === 0 };
}

// Readiness of an existing case, using hr.clearance_missing_for_case (parts with no signer that are
// not skipped) — the same list hr.forward_clearance_case checks. A missing site/department is
// reported once, as in readinessProblems; a department only matters if a department part is not skipped.
export const HR_SLOT_KEY = "hr";
export const AUTO_SKIP_REASON = "No signer is set for this site / department.";

export function caseReadiness(
  siteId: string | null,
  departmentId: string | null,
  slots: SlotInfo[],
  missing: { slot_key: string; label: string }[],
  skippedKeys: Set<string>,
) {
  const missingSite = siteId === null;
  const missingDepartment =
    departmentId === null &&
    slots.some((s) => s.scope === "department" && !skippedKeys.has(s.slot_key));
  const scopeOf = new Map(slots.map((s) => [s.slot_key, s.scope]));
  const withoutSigner = missing.filter((m) =>
    scopeOf.get(m.slot_key) === "department" ? !missingDepartment : !missingSite,
  );
  // Forward skips a part with no signer by itself (forwardCase), except HR: page one cannot be
  // skipped, so a missing HR signer still blocks.
  const slotsWithoutSigner = withoutSigner
    .filter((m) => m.slot_key === HR_SLOT_KEY)
    .map((m) => cleanSlotLabel(m.label));
  const autoSkipped = withoutSigner
    .filter((m) => m.slot_key !== HR_SLOT_KEY)
    .map((m) => cleanSlotLabel(m.label));

  const messages: string[] = [];
  if (missingSite) messages.push("No site is set for this employee.");
  if (missingDepartment) messages.push("No department is set for this employee.");
  if (slotsWithoutSigner.length > 0) {
    messages.push(`No signer for: ${slotsWithoutSigner.join(", ")} (this part cannot be skipped).`);
  }

  return {
    missingSite,
    missingDepartment,
    slotsWithoutSigner,
    autoSkipped,
    messages,
    ready: messages.length === 0,
  };
}

// One step of the clearance progress, as a circle of the shared vertical stepper
// (components/task-progress.tsx). Waiting parts are "active" while the case is In Clearance —
// they can all sign at the same time — except HR, which signs last: it becomes active only once
// every other part is signed or skipped.
export type ProgressStepState = "done" | "active" | "pending" | "skipped";
type ProgressStepLike = { key: string; done: boolean; skipped?: boolean };
const NON_SLOT_STEPS = new Set(["submitted", "forwarded", "completed"]);

export function progressStepStates(steps: ProgressStepLike[], caseStatus: string): ProgressStepState[] {
  const othersFinished = steps
    .filter((s) => !NON_SLOT_STEPS.has(s.key) && s.key !== "hr")
    .every((s) => s.done || s.skipped);
  return steps.map((s) => {
    if (s.done) return "done";
    if (s.skipped) return "skipped";
    if (s.key === "forwarded") return caseStatus === "Submitted" ? "active" : "pending";
    if (s.key === "completed") return "pending";
    return caseStatus === "In Clearance" && (s.key !== "hr" || othersFinished) ? "active" : "pending";
  });
}
