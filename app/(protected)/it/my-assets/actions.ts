"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";

const PATH = "/it/my-assets";

// INV-05 — the holder confirms they received the asset. it.acknowledge_assignment() only updates
// the caller's own open, not-yet-acknowledged assignment, so no extra check is needed here.
export async function acknowledgeAssignment(assignmentId: string) {
  const { supabase } = await requireActiveUser();

  const { error } = await supabase
    .schema("it")
    .rpc("acknowledge_assignment", { p_assignment_id: assignmentId });
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(PATH);
  redirect(`${PATH}?notice=${encodeURIComponent("Thanks — handover acknowledged.")}`);
}
