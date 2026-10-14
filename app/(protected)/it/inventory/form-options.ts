import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchOrgUnits } from "@/lib/it/ticket-data";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Dropdown data for AssetForm. Sites come from it.list_org_units() (any module:it holder) rather
// than public.org_units, which only admins can read. When editing, the asset's current type is
// kept in the list even if it has since been deactivated, so the form doesn't silently drop it.
export async function loadAssetFormOptions(
  supabase: SupabaseServerClient,
  currentAssetTypeId?: string,
) {
  let typeQuery = supabase.schema("it").from("asset_types").select("id, name").order("name");
  typeQuery = currentAssetTypeId
    ? typeQuery.or(`is_active.eq.true,id.eq.${currentAssetTypeId}`)
    : typeQuery.eq("is_active", true);

  const [{ data: assetTypes }, { data: companies }, { sites }] = await Promise.all([
    typeQuery,
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
    fetchOrgUnits(supabase),
  ]);

  return {
    assetTypes: assetTypes ?? [],
    companies: companies ?? [],
    sites: sites.map(({ id, name }) => ({ id, name })),
  };
}
