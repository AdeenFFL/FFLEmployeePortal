import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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
