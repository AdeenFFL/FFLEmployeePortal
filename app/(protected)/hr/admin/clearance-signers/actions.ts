"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

const PATH = "/hr/admin/clearance-signers";
const NOT_ALLOWED = "You are not allowed to change clearance signers.";

// Expected failures (no permission, a rule in the database function) are RETURNED, not thrown:
// Next.js hides a thrown Server Action error's message in production, and these messages are
// written for HR to read. The client wrapper shows `error` inline.
export type ActionResult = { error: string | null };

export type SignerCandidate = {
  person_id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  site_name: string | null;
  department_name: string | null;
};

async function managerClient() {
  try {
    const { supabase } = await requirePermission("hr.clearance.manage_signers");
    return supabase;
  } catch {
    return null;
  }
}

export async function searchSignerCandidates(
  query: string,
): Promise<{ error: string | null; people: SignerCandidate[] }> {
  const supabase = await managerClient();
  if (!supabase) return { error: NOT_ALLOWED, people: [] };

  const q = query.trim();
  if (q.length < 2) return { error: "Type at least 2 letters of a name or employee code.", people: [] };

  const { data, error } = await supabase
    .schema("hr")
    .rpc("clearance_search_people", { p_query: q, p_limit: 20 });
  if (error) return { error: error.message, people: [] };
  return { error: null, people: data ?? [] };
}

// unitId is a site id or a department id; which one is decided by the slot's scope here, and
// hr.add_clearance_signer checks it again (unit type, active, active employee).
export async function addSigner(slotKey: string, unitId: string, personId: string): Promise<ActionResult> {
  const supabase = await managerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { data: slot } = await supabase
    .schema("hr")
    .from("clearance_slots")
    .select("scope")
    .eq("slot_key", slotKey)
    .maybeSingle();
  if (!slot) return { error: "Signature slot not found." };

  const { error } = await supabase.schema("hr").rpc("add_clearance_signer", {
    p_slot_key: slotKey,
    p_site_id: slot.scope === "site" ? unitId : null,
    p_department_id: slot.scope === "department" ? unitId : null,
    p_person_id: personId,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { error: null };
}

export async function removeSigner(signerId: string): Promise<ActionResult> {
  const supabase = await managerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase
    .schema("hr")
    .rpc("remove_clearance_signer", { p_signer_id: signerId });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { error: null };
}

export async function makePrimarySigner(signerId: string): Promise<ActionResult> {
  const supabase = await managerClient();
  if (!supabase) return { error: NOT_ALLOWED };

  const { error } = await supabase
    .schema("hr")
    .rpc("set_clearance_primary_signer", { p_signer_id: signerId });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { error: null };
}
