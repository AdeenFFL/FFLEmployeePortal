"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

// Expected failures are RETURNED, not thrown: Next.js hides a thrown Server Action error's
// message in production, and hr.submit_clearance_self's messages are written for the employee.
export async function submitOwnClearance(lastWorkingDate: string): Promise<{ error: string | null }> {
  let supabase;
  try {
    ({ supabase } = await requirePermission("hr.clearance.request_self"));
  } catch {
    return { error: "You are not allowed to submit an offboarding request." };
  }

  const date = lastWorkingDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Please enter the last working date." };
  }

  const { error } = await supabase
    .schema("hr")
    .rpc("submit_clearance_self", { p_last_working_date: date });
  if (error) return { error: error.message };

  revalidatePath("/profile");
  return { error: null };
}
