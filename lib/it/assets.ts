import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fixedAssetTypeIds, isFixedAsset, minimumLevel, stockMinimums } from "./stock";

type Client = SupabaseClient<Database>;

// Tiles on the IT dashboard: assets by state, low stock now, repair cost in the period. Follows RLS,
// so site staff see their own sites.
export async function inventoryKpis(supabase: Client, from: Date, to: Date) {
  const [{ data: assets }, { data: repairs }, { data: levels }, { data: products }, fixedTypes, minimums] =
    await Promise.all([
      supabase.schema("it").from("assets").select("status").is("deleted_at", null),
      supabase
        .schema("it")
        .from("asset_maintenance")
        .select("cost")
        .gte("returned_date", from.toISOString().slice(0, 10))
        .lt("returned_date", to.toISOString().slice(0, 10)),
      supabase.schema("it").from("stock_levels").select("product_id, site_id, on_hand"),
      supabase.schema("it").from("products").select("id, asset_type_id, reorder_level"),
      fixedAssetTypeIds(supabase),
      stockMinimums(supabase),
    ]);
  const count = (status: string) => (assets ?? []).filter((a) => a.status === status).length;
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const lowStock = (levels ?? []).filter((l) => {
    const product = productById.get(l.product_id);
    if (!product || isFixedAsset(product, fixedTypes)) return false;
    const min = minimumLevel(minimums, product, l.site_id);
    return min !== null && l.on_hand <= min;
  }).length;
  return {
    inUse: count("In Use"),
    inRepair: count("In Repair"),
    inStock: count("Unassigned"),
    lowStock,
    repairCost: (repairs ?? []).reduce((sum, r) => sum + Number(r.cost), 0),
  };
}

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
      "id, asset_id, assigned_date, assigned_condition, remarks, acknowledged_at, assets(asset_tag, asset_name, serial_number, manufacturer, model_number, asset_types(name))",
    )
    .eq("person_id", personId)
    .is("return_date", null)
    .order("assigned_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
