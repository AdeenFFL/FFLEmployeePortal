import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "../asset-form";
import { createAsset } from "../actions";

export default async function NewAssetPage() {
  const supabase = await createClient();

  // proxy.ts only checks it.assets.read for /it/inventory/*; creating needs its own permission.
  const { data: canCreate } = await supabase.rpc("has_permission", {
    p_permission_key: "it.assets.create",
  });
  if (!canCreate) redirect("/unauthorized");

  const [{ data: assetTypes }, { data: companies }, { data: sites }] = await Promise.all([
    supabase
      .schema("it")
      .from("asset_types")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
    // Admin-only under org_units' current RLS — everyone else gets an empty list.
    supabase
      .from("org_units")
      .select("id, name")
      .eq("type", "Site")
      .eq("is_active", true)
      .order("name"),
  ]);

  return (
    <div className="py-6">
      <PageHeader title="Add Asset" description="Register a new IT asset in the inventory." />
      <AssetForm
        action={createAsset}
        assetTypes={assetTypes ?? []}
        companies={companies ?? []}
        sites={sites ?? []}
        submitLabel="Register Asset"
      />
    </div>
  );
}
