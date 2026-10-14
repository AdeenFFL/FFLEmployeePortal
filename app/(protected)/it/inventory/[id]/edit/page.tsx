import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "../../asset-form";
import { updateAsset } from "../../actions";
import { loadAssetFormOptions } from "../../form-options";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // proxy.ts only checks it.assets.read for /it/inventory/*; editing needs its own permission.
  const { data: canUpdate } = await supabase.rpc("has_permission", {
    p_permission_key: "it.assets.update",
  });
  if (!canUpdate) redirect("/unauthorized");

  const { data: asset } = await supabase
    .schema("it")
    .from("assets")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset) notFound();

  const options = await loadAssetFormOptions(supabase, asset.asset_type_id);

  return (
    <div className="py-6">
      <PageHeader title={`Edit ${asset.asset_tag}`} description={asset.asset_name} />
      <AssetForm
        action={updateAsset.bind(null, asset.id)}
        {...options}
        asset={asset}
        submitLabel="Save Changes"
        cancelHref={`/it/inventory/${asset.id}`}
      />
    </div>
  );
}
