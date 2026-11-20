import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { cardClass, FormMessage, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";
import { BackLink } from "../../_components/ui";
import { createProduct } from "../actions";
import { ProductFields, type AssetTypeOption } from "../product-fields";

// Add a product to the Product Master (PRC-02). Saving opens the new product's page.
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  if (!(await hasItPermission(supabase, "it.products.update"))) notFound();

  const [typesRes, categoriesRes] = await Promise.all([
    supabase.schema("it").from("asset_types").select("id, name, is_active, classification").order("name"),
    supabase.schema("it").from("products").select("category").not("category", "is", null),
  ]);
  const assetTypes: AssetTypeOption[] = checked(typesRes).data ?? [];
  const categories = [...new Set((checked(categoriesRes).data ?? []).map((r) => r.category as string))].sort(
    (a, b) => a.localeCompare(b),
  );

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-3">
        <BackLink href="/it/procurement/products" label="Products" />
      </div>
      <PageHeader title="Add product" description="Once saved it can be picked when raising a demand." />
      <FormMessage error={params.error} />

      <form action={createProduct} className={cardClass}>
        <ProductFields assetTypes={assetTypes} categories={categories} />
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <Link href="/it/procurement/products" className={secondaryButtonClass}>
            Cancel
          </Link>
          <button type="submit" className={primaryButtonClass}>
            Add product
          </button>
        </div>
      </form>
    </div>
  );
}
