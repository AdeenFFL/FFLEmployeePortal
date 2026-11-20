"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

const LIST_PATH = "/hr/resignations";
const NOT_ALLOWED = "You are not allowed to do this (it needs Forward Offboarding Requests).";

// Expected failures (no permission, a rule in the database function) are RETURNED, not thrown:
// Next.js hides a thrown Server Action error's message in production, and these messages are
// written for the HRBP to read. The client components show `error` inline, never in the URL.
export type ActionResult = { error: string | null };

export type EmployeeCandidate = {
  person_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  person_status: string;
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
  has_open_case: boolean;
};

async function forwarderClient() {
  try {
    const { supabase } = await requirePermission("hr.clearance.forward");
    return supabase;
  } catch {
    return null;
  }
}

function revalidateCase(caseId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${caseId}`);
}

export async function searchEmployees(
  query: string,
): Promise<{ error: string | null; people: EmployeeCandidate[] }> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED, people: [] };

  const q = query.trim();
  if (q.length < 2) return { error: "Type at least 2 letters of a name or employee code.", people: [] };

  const { data, error } = await supabase
    .schema("hr")
    .rpc("clearance_search_employees", { p_query: q, p_limit: 20 });
  if (error) return { error: error.message, people: [] };
  return { error: null, people: data ?? [] };
}

export async function startClearance(
  personId: string,
  lastWorkingDate: string,
): Promise<{ error: string | null; caseId: string | null }> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED, caseId: null };

  const date = lastWorkingDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Please enter the last working date.", caseId: null };
  }

  const { data, error } = await supabase
    .schema("hr")
    .rpc("raise_clearance_for", { p_person_id: personId, p_last_working_date: date });
  if (error) return { error: error.message, caseId: null };

  revalidatePath(LIST_PATH);
  return { error: null, caseId: data };
}

export async function forwardCase(caseId: string): Promise<ActionResult> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase.schema("hr").rpc("forward_clearance_case", { p_case_id: caseId });
  if (error) return { error: error.message };

  revalidateCase(caseId);
  return { error: null };
}

export async function cancelCase(caseId: string, reason: string): Promise<ActionResult> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const trimmed = reason.trim();
  if (!trimmed) return { error: "Please give a reason." };

  const { error } = await supabase
    .schema("hr")
    .rpc("cancel_clearance_case", { p_case_id: caseId, p_reason: trimmed });
  if (error) return { error: error.message };

  revalidateCase(caseId);
  return { error: null };
}

// A skip changes what the signers and the employee see, so their pages are refreshed too.
function revalidateSkip(caseId: string) {
  revalidateCase(caseId);
  revalidatePath("/hr/clearance", "layout");
  revalidatePath("/requests");
  revalidatePath(`/requests/offboarding/${caseId}`);
}

export async function skipSlot(caseId: string, slotKey: string, reason: string): Promise<ActionResult> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 300) {
    return { error: "Please give a short reason (3 to 300 characters)." };
  }

  const { error } = await supabase
    .schema("hr")
    .rpc("skip_clearance_slot", { p_case_id: caseId, p_slot_key: slotKey, p_reason: trimmed });
  if (error) return { error: error.message };

  revalidateSkip(caseId);
  return { error: null };
}

export async function unskipSlot(caseId: string, slotKey: string): Promise<ActionResult> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase
    .schema("hr")
    .rpc("unskip_clearance_slot", { p_case_id: caseId, p_slot_key: slotKey });
  if (error) return { error: error.message };

  revalidateSkip(caseId);
  return { error: null };
}

export async function refreshCaseOrg(caseId: string): Promise<ActionResult> {
  const supabase = await forwarderClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase
    .schema("hr")
    .rpc("refresh_clearance_case_org", { p_case_id: caseId });
  if (error) return { error: error.message };

  revalidateCase(caseId);
  return { error: null };
}
