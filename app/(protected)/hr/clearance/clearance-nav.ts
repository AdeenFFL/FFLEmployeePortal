import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { countMyOpenWork } from "./it-clearance-work";

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

// What the sidebar needs besides the role's permissions: the menu flags above and the number on
// "My Tasks". Used by the layout (first render) and /api/me/permissions (live re-check).
export async function getNavExtras(): Promise<{ keys: string[]; taskCount: number }> {
  const supabase = await createClient();
  const [signer, taskCount] = await Promise.all([isClearanceSigner(), countMyOpenWork(supabase)]);
  return {
    keys: [...(signer ? [CLEARANCE_SIGNER_NAV_KEY] : []), ...(taskCount > 0 ? [MY_TASKS_NAV_KEY] : [])],
    taskCount,
  };
}
