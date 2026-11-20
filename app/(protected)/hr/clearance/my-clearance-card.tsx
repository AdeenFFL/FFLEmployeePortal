import { createClient } from "@/lib/supabase/server";
import { OffboardingCard } from "./offboarding-card";

// The signed-in employee's own Clearance card (the same one as on /profile), for the popup on Home
// and Raise a Ticket: looks up who I am and my site / department, then renders OffboardingCard.
export async function MyClearanceCard() {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return null;

  const { data: me } = await supabase
    .from("persons")
    .select("site_id, department_id")
    .eq("id", personId)
    .maybeSingle();

  return (
    <OffboardingCard
      personId={personId}
      siteId={me?.site_id ?? null}
      departmentId={me?.department_id ?? null}
    />
  );
}
