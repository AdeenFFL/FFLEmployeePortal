import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { DEMAND_STATUS_TONE, formatMoney } from "@/lib/it/procurement";
import { cardClass, FormMessage, primaryButtonClass } from "../../../_components/ticket-ui";
import { BackLink } from "../../_components/ui";
import { ProductIcon, productKind } from "../../_components/product-icon";
import { setProductActive, updateProduct } from "../actions";
import { ProductFields, type AssetTypeOption } from "../product-fields";

const RECENT_DEMANDS = 5;

// One product (PRC-02): what it is, its demands, and — with it.products.update — the edit form
// and activate / deactivate. Products are never deleted (demands and stock keep pointing at them).
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const [{ data: canRead }, canEdit] = await Promise.all([
    supabase.schema("it").rpc("can_read_procurement_masters"),
    hasItPermission(supabase, "it.products.update"),
  ]);
  if (!canRead) notFound();

  const [productRes, typesRes, categoriesRes, demandsRes] = await Promise.all([
    supabase.schema("it").from("products").select("*").eq("id", id).maybeSingle(),
    supabase.schema("it").from("asset_types").select("id, name, is_active").order("name"),
    supabase.schema("it").from("products").select("category").not("category", "is", null),
    supabase
      .schema("it")
      .from("demands")
      .select("id, demand_number, quantity, status, created_at", { count: "exact" })
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(RECENT_DEMANDS),
  ]);
  const product = checked(productRes).data;
  if (!product) notFound();
  const assetTypes: AssetTypeOption[] = checked(typesRes).data ?? [];
  const categories = [...new Set((checked(categoriesRes).data ?? []).map((r) => r.category as string))].sort(
    (a, b) => a.localeCompare(b),
  );
  // Demands are RLS-filtered: this is what the viewer may see, not necessarily every demand.
  const demands = demandsRes.error ? [] : (demandsRes.data ?? []);
  const demandCount = demandsRes.error ? 0 : (demandsRes.count ?? demands.length);
  const typeName = assetTypes.find((t) => t.id === product.asset_type_id)?.name;
  const noPrice = !product.current_price || Number(product.current_price) <= 0;

  return (
    <div className="py-6">
      <div className="mb-3">
        <BackLink href="/it/procurement/products" label="Products" />
      </div>

      {/* Summary */}
      <div className={`${cardClass} mb-6 flex flex-wrap items-center gap-5 p-6`}>
        <span
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
            product.is_active ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"
          }`}
        >
          <ProductIcon kind={productKind({ name: product.product_name, category: product.category })} className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{product.product_name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {product.asset_type_id ? (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                Fixed asset · {typeName ?? "type"}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Consumable / service
              </span>
            )}
            {!product.is_active && <StatusPill label="Inactive" tone="warning" />}
            <span>{[product.category, `per ${product.unit}`].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <dl className="flex gap-8 text-right">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Purchase</dt>
            <dd className="mt-1 text-lg tabular-nums text-slate-600">{formatMoney(product.purchase_price)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Current</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${noPrice ? "text-amber-700" : "text-slate-900"}`}>
              {noPrice ? "Not set" : formatMoney(product.current_price)}
            </dd>
          </div>
        </dl>
      </div>

      <FormMessage error={sp.error} notice={sp.notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {canEdit ? (
            <form action={updateProduct.bind(null, product.id)} className={cardClass}>
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">Edit product</h2>
              </div>
              <ProductFields product={product} assetTypes={assetTypes} categories={categories} />
              <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-6 py-4">
                <button type="submit" className={primaryButtonClass}>
                  Save changes
                </button>
              </div>
            </form>
          ) : (
            <div className={`${cardClass} p-6`}>
              <h2 className="mb-2 text-base font-semibold text-slate-900">Specification</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-600">
                {product.description || "No specification recorded."}
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className={cardClass}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Demands</h2>
              <span className="text-xs text-slate-400">{demandCount} total</span>
            </div>
            {demands.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">No demands for this product yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {demands.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/it/procurement/demands/${d.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{d.demand_number}</span>
                        <span className="block text-xs text-slate-500">
                          Qty {d.quantity} · {new Date(d.created_at).toLocaleDateString("en-GB")}
                        </span>
                      </span>
                      <StatusPill label={d.status} tone={DEMAND_STATUS_TONE[d.status as keyof typeof DEMAND_STATUS_TONE]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canEdit && (
            <div className={`${cardClass} p-5`}>
              <h2 className="text-sm font-semibold text-slate-900">
                {product.is_active ? "Stop using this product" : "Use this product again"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {product.is_active
                  ? "Deactivated products can't be picked for new demands. Existing demands are not affected."
                  : "Reactivating makes it available in Raise demand again."}
              </p>
              <form action={setProductActive.bind(null, product.id, !product.is_active)} className="mt-3">
                <button
                  type="submit"
                  className={
                    product.is_active
                      ? "w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      : "w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  }
                >
                  {product.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
