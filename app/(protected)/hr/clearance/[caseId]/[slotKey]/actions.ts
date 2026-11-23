"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";
import { queueItEmails } from "@/lib/it/notifications";
import { HR_DETAIL_FIELDS, MAX_DECIMAL, type HrDetailsValues } from "../../hr-details-fields";

const LIST_PATH = "/hr/clearance";
const TASKS_PATH = "/hr/clearance/tasks";
const NOT_ALLOWED = "You are not allowed to do this (it needs Sign Clearance Forms).";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = ["Yes", "No", "N/A"] as const;
const MAX_REMARKS = 500;
const LINE_MANAGER_LOCKED =
  "The HR details are saved with this line manager, so it can no longer be changed.";

// Expected failures (no permission, a rule in the database function) are RETURNED, not thrown:
// Next.js hides a thrown Server Action error's message in production. The form shows `error`
// inline, never in the URL. Whether this person signs this part is checked by the database
// functions themselves (hr.is_clearance_signer).
export type ActionResult = { error: string | null };

async function signerClient() {
  try {
    const { supabase } = await requirePermission("hr.clearance.sign");
    return supabase;
  } catch {
    return null;
  }
}

function cleanRemarks(value: string | null) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function saveClearanceAnswer(
  caseId: string,
  lineId: string,
  outcome: string,
  remarks: string | null,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId) || !UUID_PATTERN.test(lineId)) return { error: "Line not found." };
  const answer = OUTCOMES.find((o) => o === outcome);
  if (!answer) return { error: "Please choose an answer." };
  const note = cleanRemarks(remarks);
  // App rule (not in the database): a negative answer needs a reason.
  if (answer === "No" && !note) return { error: "Please write a short remark for this answer." };
  if (note && note.length > MAX_REMARKS) {
    return { error: `Remarks can be at most ${MAX_REMARKS} characters.` };
  }

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("set_clearance_response", {
    p_case_id: caseId,
    p_line_id: lineId,
    p_outcome: answer,
    p_remarks: note,
  });
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${caseId}`, "layout");
  revalidatePath(TASKS_PATH);
  return { error: null };
}

export async function signClearancePart(
  caseId: string,
  slotKey: string,
  remarks: string | null,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId)) return { error: "Request not found." };
  const note = cleanRemarks(remarks);
  if (note && note.length > MAX_REMARKS) {
    return { error: `Remarks can be at most ${MAX_REMARKS} characters.` };
  }

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("sign_clearance", {
    p_case_id: caseId,
    p_slot_key: slotKey,
    p_remarks: note,
  });
  if (error) return { error: error.message };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${caseId}/${slotKey}`);
  return { error: null };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The page-one details (HR signer only). hr.save_clearance_details overwrites every field in one
// call and checks who may call it; the checks here only give clearer messages first (e.g. the
// numeric(7,2) limit, which the database would report as "numeric field overflow").
export async function saveClearanceDetails(
  caseId: string,
  values: HrDetailsValues,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId)) return { error: "Request not found." };

  const text: Partial<Record<keyof HrDetailsValues, string | null>> = {};
  const numbers: Partial<Record<keyof HrDetailsValues, number | null>> = {};
  for (const field of HR_DETAIL_FIELDS) {
    if (field.fromPicker) continue;
    const raw = String(values?.[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) return { error: `Please fill in: ${field.label}.` };
      text[field.key] = null;
      numbers[field.key] = null;
      continue;
    }
    if (field.maxLength && raw.length > field.maxLength) {
      return { error: `${field.label} can be at most ${field.maxLength} characters.` };
    }
    if (field.kind === "email" && !raw.includes("@")) {
      return { error: "Please enter a valid email address." };
    }
    if (field.kind === "date" && (!DATE_PATTERN.test(raw) || Number.isNaN(Date.parse(raw)))) {
      return { error: `${field.label} is not a valid date.` };
    }
    if (field.kind === "whole") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return { error: `${field.label} must be a whole number of days from 0 to 365.` };
      }
      numbers[field.key] = n;
    }
    if (field.kind === "decimal") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > MAX_DECIMAL) {
        return { error: `${field.label} must be a number from 0 to ${MAX_DECIMAL}.` };
      }
      numbers[field.key] = Math.round(n * 100) / 100;
    }
    text[field.key] = raw;
  }
  // App rule (not in the database): the last working date comes after the date of joining.
  // Both are YYYY-MM-DD here, so comparing the text compares the dates.
  if (text.date_of_joining && text.last_working_date && text.last_working_date <= text.date_of_joining) {
    return { error: "Last working date must be after the date of joining." };
  }

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  // The manager's name is set by set_clearance_line_manager; send back what the case holds now so
  // an open form never overwrites a newer choice.
  const { data: current, error: caseError } = await supabase
    .schema("hr")
    .from("clearance_cases")
    .select("reporting_manager_name, line_manager_person_id")
    .eq("id", caseId)
    .maybeSingle();
  if (caseError || !current) return { error: "Request not found." };
  // App rule (not in the database): the line manager is chosen before the details are saved.
  if (!current.line_manager_person_id) {
    return { error: "First choose the line manager (the “Line manager” step), then save the details." };
  }

  const { error } = await supabase.schema("hr").rpc("save_clearance_details", {
    p_case_id: caseId,
    p_contact_phone: text.contact_phone ?? null,
    p_contact_email: text.contact_email ?? null,
    p_postal_address: text.postal_address ?? null,
    p_reporting_manager_name: current.reporting_manager_name,
    p_date_of_joining: text.date_of_joining ?? null,
    p_last_working_date: text.last_working_date!,
    p_resignation_letter_date: text.resignation_letter_date ?? null,
    p_resignation_effective_from: text.resignation_effective_from ?? null,
    p_unserved_notice_days: numbers.unserved_notice_days ?? null,
    p_overtime_single: numbers.overtime_single ?? null,
    p_overtime_double: numbers.overtime_double ?? null,
    p_overtime_triple: numbers.overtime_triple ?? null,
    p_annual_leave_balance: numbers.annual_leave_balance ?? null,
    p_other_outstanding: text.other_outstanding ?? null,
    p_handing_over_to: text.handing_over_to ?? null,
    p_email_forward_to: text.email_forward_to ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`${LIST_PATH}/${caseId}/hr`);
  // The last working date also shows on the HRBP case page and the employee's request page.
  revalidatePath(`/hr/clearance-requests/${caseId}`);
  revalidatePath(`/requests/offboarding/${caseId}`);
  return { error: null };
}

export type ManagerCandidate = {
  person_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
};

// Active employees for the Line manager picker (hr.clearance_search_managers needs Sign).
export async function searchLineManagers(
  query: string,
): Promise<{ error: string | null; people: ManagerCandidate[] }> {
  const q = query.trim();
  if (q.length < 2) return { error: "Type at least 2 letters of a name or employee code.", people: [] };

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED, people: [] };

  const { data, error } = await supabase
    .schema("hr")
    .rpc("clearance_search_managers", { p_query: q, p_limit: 20 });
  if (error) return { error: error.message, people: [] };
  return { error: null, people: data ?? [] };
}

// Choose (or clear, with null) the line manager who confirms "Complete data received". The
// database checks that this person is the case's HR signer and that the manager has not confirmed.
export async function setLineManager(
  caseId: string,
  managerPersonId: string | null,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId)) return { error: "Request not found." };
  if (managerPersonId !== null && !UUID_PATTERN.test(managerPersonId)) {
    return { error: "Line manager not found." };
  }

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  // App rule (not in the database): once the HR details are saved with a line manager chosen,
  // the manager is locked. If the details were saved with none, one can still be chosen once.
  const hr = supabase.schema("hr");
  const [caseResult, detailsResult] = await Promise.all([
    hr.from("clearance_cases").select("line_manager_person_id").eq("id", caseId).maybeSingle(),
    hr.from("clearance_hr_details").select("case_id").eq("case_id", caseId).maybeSingle(),
  ]);
  if (caseResult.error || detailsResult.error || !caseResult.data) {
    return { error: "Request not found." };
  }
  if (caseResult.data.line_manager_person_id && detailsResult.data) {
    return { error: LINE_MANAGER_LOCKED };
  }

  const { error } = await supabase.schema("hr").rpc("set_clearance_line_manager", {
    p_case_id: caseId,
    p_manager_person_id: managerPersonId,
  });
  if (error) return { error: error.message };

  // The database queued a notification for the chosen manager (talha_hr_0012): send the email.
  if (managerPersonId) queueItEmails();

  revalidatePath(`${LIST_PATH}/${caseId}/hr`);
  revalidatePath(`/hr/clearance-requests/${caseId}`);
  revalidatePath("/requests");
  revalidatePath(`/requests/offboarding/${caseId}`);
  return { error: null };
}

export type ItStaffCandidate = ManagerCandidate;

// Active IT staff for the "Assign to" picker (hr.clearance_search_it_staff needs Sign).
export async function searchItStaff(
  query: string,
): Promise<{ error: string | null; people: ItStaffCandidate[] }> {
  const q = query.trim();
  if (q.length < 2) return { error: "Type at least 2 letters of a name or employee code.", people: [] };

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED, people: [] };

  const { data, error } = await supabase
    .schema("hr")
    .rpc("clearance_search_it_staff", { p_query: q, p_limit: 20 });
  if (error) return { error: error.message, people: [] };
  return { error: null, people: data ?? [] };
}

// The IT Team Lead hands one line to an IT staff member (or takes it back with null). The database
// checks that the caller signs this part and that the person is IT staff, and queues the
// notification + email; the email is sent after the response (queueItEmails).
export async function assignClearanceLine(
  caseId: string,
  lineId: string,
  personId: string | null,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId) || !UUID_PATTERN.test(lineId)) return { error: "Line not found." };
  if (personId !== null && !UUID_PATTERN.test(personId)) return { error: "Person not found." };

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("assign_clearance_line", {
    p_case_id: caseId,
    p_line_id: lineId,
    p_person_id: personId,
  });
  if (error) return { error: error.message };

  if (personId) queueItEmails();
  revalidatePath(`${LIST_PATH}/${caseId}/it`);
  revalidatePath(TASKS_PATH);
  return { error: null };
}

// The IT Team Lead hands the return of one asset to an IT staff member (or takes it back with
// null). Same checks and notification as a line (hr.assign_clearance_asset).
export async function assignClearanceAsset(
  caseId: string,
  assignmentId: string,
  personId: string | null,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId) || !UUID_PATTERN.test(assignmentId)) return { error: "Asset not found." };
  if (personId !== null && !UUID_PATTERN.test(personId)) return { error: "Person not found." };

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("assign_clearance_asset", {
    p_case_id: caseId,
    p_assignment_id: assignmentId,
    p_person_id: personId,
  });
  if (error) return { error: error.message };

  if (personId) queueItEmails();
  revalidatePath(`${LIST_PATH}/${caseId}/it`);
  revalidatePath(TASKS_PATH);
  return { error: null };
}

const ASSET_RETURN_STATUSES = ["Unassigned", "Retired", "Lost"] as const;
const MAX_ASSET_TEXT = 300;

// The IT signer returns one asset (or marks it Lost) from the clearance form. The database closes
// the assignment and sets the asset status in IT Inventory at once, and checks who may do it.
export async function returnClearanceAsset(
  caseId: string,
  assignmentId: string,
  condition: string,
  newStatus: string,
  remarks: string,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId) || !UUID_PATTERN.test(assignmentId)) {
    return { error: "Asset not found." };
  }
  const status = ASSET_RETURN_STATUSES.find((s) => s === newStatus);
  if (!status) return { error: "Please choose what happens to the asset." };
  const cond = condition.trim();
  const note = remarks.trim();
  // App rule (not in the database): a Lost asset needs a remark.
  if (status === "Lost" && !note) return { error: "Please write a remark for a lost asset." };
  if (cond.length > MAX_ASSET_TEXT || note.length > MAX_ASSET_TEXT) {
    return { error: `Condition and remarks can be at most ${MAX_ASSET_TEXT} characters.` };
  }

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("clearance_return_asset", {
    p_case_id: caseId,
    p_assignment_id: assignmentId,
    p_returned_condition: cond || null,
    p_new_status: status,
    p_remarks: note || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`${LIST_PATH}/${caseId}/it`);
  revalidatePath(TASKS_PATH);
  revalidatePath("/it/inventory");
  return { error: null };
}
