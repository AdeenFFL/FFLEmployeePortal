import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "../asset-form";
import { createAsset } from "../actions";
import { loadAssetFormOptions } from "../form-options";

export default async function NewAssetPage() {
  const supabase = await createClient();

  // proxy.ts only checks it.assets.read for /it/inventory/*; creating needs its own permission.
  const { data: canCreate } = await supabase.rpc("has_permission", {
    p_permission_key: "it.assets.create",
  });
  if (!canCreate) redirect("/unauthorized");

  const options = await loadAssetFormOptions(supabase);

  return (
    <div className="py-6">
      <PageHeader title="Add Asset" description="Register a new IT asset in the inventory." />
      <AssetForm action={createAsset} {...options} submitLabel="Register Asset" />
    </div>
  );
}
