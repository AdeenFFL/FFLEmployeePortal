"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";
import { HR_DETAIL_FIELDS, MAX_DECIMAL, type HrDetailsValues } from "../../hr-details-fields";

const LIST_PATH = "/hr/clearance";
const NOT_ALLOWED = "You are not allowed to do this (it needs Sign Clearance Forms).";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = ["Yes", "No", "N/A"] as const;
const MAX_REMARKS = 500;

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

  const supabase = await signerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("save_clearance_details", {
    p_case_id: caseId,
    p_contact_phone: text.contact_phone ?? null,
    p_contact_email: text.contact_email ?? null,
    p_postal_address: text.postal_address ?? null,
    p_reporting_manager_name: text.reporting_manager_name ?? null,
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
  });
  if (error) return { error: error.message };

  revalidatePath(`${LIST_PATH}/${caseId}`, "layout");
  // The last working date also shows on the HRBP case page and the employee's request page.
  revalidatePath(`/hr/resignations/${caseId}`);
  revalidatePath(`/requests/offboarding/${caseId}`);
  return { error: null };
}
