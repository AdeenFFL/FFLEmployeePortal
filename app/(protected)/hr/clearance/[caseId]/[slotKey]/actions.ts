"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

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
