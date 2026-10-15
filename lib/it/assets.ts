import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

// Inventory track helpers shared with Javaria's on/offboarding flow (07-it-inventory-plan.md §2.1).

// The assets a person currently holds (open assignments), newest first. Used by My Assets and by
// offboarding ("what does the leaver still hold?").
//
// Reads through RLS (talha_it_0004): the caller sees results only if they hold it.assets.read or
// they ARE the person. Anyone else — e.g. onboarding staff without it.assets.read — gets an empty
// list, not an error.
export async function listOpenAssignments(supabase: Client, personId: string) {
  const { data, error } = await supabase
    .schema("it")
    .from("asset_assignments")
    .select(
      "id, asset_id, assigned_date, assigned_condition, remarks, acknowledged_at, assets(asset_tag, asset_name, serial_number, asset_types(name))",
    )
    .eq("person_id", personId)
    .is("return_date", null)
    .order("assigned_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
