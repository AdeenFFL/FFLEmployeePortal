import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

// javaria_it_0022: a product is a FIXED ASSET only when its asset type is classified Fixed
// (same rule as it.product_is_fixed_asset). No asset type, or a Consumable type such as Toner or
// Cable, means the product is counted as stock.
export async function fixedAssetTypeIds(supabase: Client) {
  const { data } = await supabase.schema("it").from("asset_types").select("id").eq("classification", "Fixed");
  return new Set((data ?? []).map((t) => t.id));
}

export function isFixedAsset(product: { asset_type_id: string | null }, fixedTypes: Set<string>) {
  return Boolean(product.asset_type_id && fixedTypes.has(product.asset_type_id));
}

// On hand per product at a site (RLS: it.stock.read). Missing rows mean 0.
export async function stockAtSite(supabase: Client, siteId: string, productIds?: string[]) {
  let query = supabase.schema("it").from("stock_levels").select("product_id, on_hand").eq("site_id", siteId);
  if (productIds?.length) query = query.in("product_id", productIds);
  const { data, error } = await query;
  return error ? null : new Map((data ?? []).map((r) => [r.product_id, r.on_hand]));
}
