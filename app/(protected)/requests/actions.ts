"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Expected failures are RETURNED, not thrown, and shown inline (never in the URL).
export type ActionResult = { error: string | null };

// The line manager confirms "Complete data received" for a leaving employee. No permission is
// needed: hr.confirm_data_received checks that the caller is the line manager chosen on the case.
export async function confirmDataReceived(caseId: string): Promise<ActionResult> {
  if (!UUID_PATTERN.test(caseId)) return { error: "Request not found." };

  const supabase = await createClient();
  const { error } = await supabase.schema("hr").rpc("confirm_data_received", { p_case_id: caseId });
  if (error) return { error: error.message };

  revalidatePath("/requests");
  revalidatePath("/hr/clearance", "layout");
  revalidatePath(`/hr/resignations/${caseId}`);
  return { error: null };
}
