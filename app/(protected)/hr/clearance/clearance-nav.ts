import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { countMyOpenWork, loadMySigningTasks } from "./it-clearance-work";

// Every role holds hr.clearance.sign (talha_hr_0009) so that anyone can be made a signer without
// changing their role; the permission alone therefore does not mean "is a signer". For the menu
// and the Clearance cards, a signer is someone with at least one row in hr.clearance_signers (RLS
// lets a person read their own rows).
export const CLEARANCE_SIGNER_NAV_KEY = "clearance:is_signer";

export const isClearanceSigner = cache(async () => {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return false;
  const { count, error } = await supabase
    .schema("hr")
    .from("clearance_signers")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId);
  return !error && (count ?? 0) > 0;
});

// Menu-only flag: shows the personal "My Tasks" link to anyone with something to do there (on top
// of IT staff, who always see it).
export const MY_TASKS_NAV_KEY = "tasks:has_open";

// Requests waiting for HR to forward (status Submitted). Only for people who can forward them
// (hr.clearance.read_all); anyone else gets 0, so an employee's own submitted request never counts.
async function countRequestsToForward(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: canReadAll } = await supabase.rpc("has_permission", {
    p_permission_key: "hr.clearance.read_all",
  });
  if (!canReadAll) return 0;
  const { count, error } = await supabase
    .schema("hr")
    .from("clearance_cases")
    .select("id", { count: "exact", head: true })
    .eq("status", "Submitted");
  return error ? 0 : (count ?? 0);
}

// The number on "Clearance" (and on HR Management while it is closed): requests to forward plus
// the parts waiting for my signature.
async function countClearanceWork(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [toForward, toSign] = await Promise.all([
    countRequestsToForward(supabase),
    isClearanceSigner().then(async (signer) => {
      if (!signer) return 0;
      const { data: personId } = await supabase.rpc("current_person_id");
      return personId ? (await loadMySigningTasks(supabase, personId, "open")).length : 0;
    }),
  ]);
  return toForward + toSign;
}

// What the sidebar needs besides the role's permissions: the menu flags above and the numbers on
// "My Tasks" and "Clearance". Used by the layout (first render) and /api/me/permissions (live
// re-check).
export async function getNavExtras(): Promise<{
  keys: string[];
  taskCount: number;
  clearanceCount: number;
}> {
  const supabase = await createClient();
  const [signer, taskCount, clearanceCount] = await Promise.all([
    isClearanceSigner(),
    countMyOpenWork(supabase),
    countClearanceWork(supabase),
  ]);
  return {
    keys: [...(signer ? [CLEARANCE_SIGNER_NAV_KEY] : []), ...(taskCount > 0 ? [MY_TASKS_NAV_KEY] : [])],
    taskCount,
    clearanceCount,
  };
}
