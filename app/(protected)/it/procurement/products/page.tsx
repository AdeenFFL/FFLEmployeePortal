import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { formatMoney, PRODUCT_UNITS } from "@/lib/it/procurement";
import type { ItProduct } from "@/types/database";
import { createProduct, setProductActive, updateProduct } from "./actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

type AssetTypeOption = { id: string; name: string; is_active: boolean };

// One set of fields for both Add and Edit. Inactive asset types are only offered when the
// product already uses one, so editing doesn't silently drop the link.
function ProductFields({
  product,
  assetTypes,
}: {
  product?: ItProduct;
  assetTypes: AssetTypeOption[];
}) {
  const options = assetTypes.filter((t) => t.is_active || t.id === product?.asset_type_id);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="block">
        <span className={labelClass}>
          Product name <span className="text-red-500">*</span>
        </span>
        <input name="productName" required defaultValue={product?.product_name ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Category</span>
        <input
          name="category"
          list="product-categories"
          defaultValue={product?.category ?? ""}
          placeholder="e.g. Laptops, Toner, Cables"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Unit</span>
        <input name="unit" list="product-units" defaultValue={product?.unit ?? "Each"} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Purchase price (Rs)</span>
        <input
          name="purchasePrice"
          inputMode="decimal"
          defaultValue={product?.purchase_price ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Current price (Rs)</span>
        <input
          name="currentPrice"
          inputMode="decimal"
          defaultValue={product?.current_price ?? ""}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Asset type</span>
        <select name="assetTypeId" defaultValue={product?.asset_type_id ?? ""} className={inputClass}>
          <option value="">None — consumable / service</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-400">
          Pick one if receiving this product should register assets.
        </span>
      </label>
      <label className="block md:col-span-3">
        <span className={labelClass}>Description / specification</span>
        <textarea name="description" rows={2} defaultValue={product?.description ?? ""} className={inputClass} />
      </label>
    </div>
  );
}

// PRC-02 Product Master (BRD §5.5.7, ERD D "products"). Read-only for anyone who can read the
// procurement masters; add / edit / deactivate with it.products.update (javaria_it_0013).
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    kind?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const kind = params.kind === "asset" || params.kind === "consumable" ? params.kind : "all";
  const supabase = await createClient();

  const [{ data: canRead }, canEdit] = await Promise.all([
    supabase.schema("it").rpc("can_read_procurement_masters"),
    hasItPermission(supabase, "it.products.update"),
  ]);
  if (!canRead) notFound();

  let query = supabase.schema("it").from("products").select("*").order("product_name");
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (kind === "asset") query = query.not("asset_type_id", "is", null);
  if (kind === "consumable") query = query.is("asset_type_id", null);
  const q = (params.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) {
    query = query.or(`product_name.ilike.%${q}%,category.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const [productsRes, typesRes, categoriesRes] = await Promise.all([
    query,
    supabase.schema("it").from("asset_types").select("id, name, is_active").order("name"),
    supabase.schema("it").from("products").select("category").not("category", "is", null),
  ]);
  const rows = checked(productsRes).data ?? [];
  const assetTypes: AssetTypeOption[] = checked(typesRes).data ?? [];
  const typeName = new Map(assetTypes.map((t) => [t.id, t.name]));
  const categories = [
    ...new Set((checked(categoriesRes).data ?? []).map((r) => r.category as string)),
  ].sort((a, b) => a.localeCompare(b));
  const filtered = q || status !== "active" || kind !== "all";

  return (
    <div className="py-6">
      <PageHeader
        title="Product Master"
        description="Items IT buys. Products with an asset type become assets when received; the rest go into stock."
        action={
          <Link href="/it/procurement/vendors" className={secondaryButtonClass}>
            Vendor Master
          </Link>
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      <datalist id="product-units">
        {PRODUCT_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="product-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {canEdit && (
        <details className={`${cardClass} mb-6 p-6`} open={rows.length === 0 && !filtered}>
          <summary className="cursor-pointer text-base font-semibold text-slate-900">Add product</summary>
          <form action={createProduct} className="mt-4 space-y-4">
            <ProductFields assetTypes={assetTypes} />
            <button type="submit" className={primaryButtonClass}>
              Add product
            </button>
          </form>
        </details>
      )}

      <form method="get" className={`${cardClass} mb-6 flex flex-wrap items-center gap-3 p-4`}>
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name, category or description"
          aria-label="Search products"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <select name="kind" defaultValue={kind} aria-label="Kind" className={`${inputClass} w-auto`}>
          <option value="all">All kinds</option>
          <option value="asset">Fixed assets</option>
          <option value="consumable">Consumables / services</option>
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputClass} w-auto`}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={primaryButtonClass}>
          Search
        </button>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {filtered ? "No products match." : canEdit ? "No products yet — add the first one above." : "No products yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {p.product_name}
                      {p.asset_type_id ? (
                        <StatusPill label={`Asset · ${typeName.get(p.asset_type_id) ?? "type"}`} tone="info" />
                      ) : (
                        <StatusPill label="Consumable" tone="neutral" />
                      )}
                      {!p.is_active && <StatusPill label="Inactive" tone="warning" />}
                    </p>
                    <p className="text-sm text-slate-600">
                      {[p.category, `per ${p.unit}`].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-slate-400">
                      Purchase {formatMoney(p.purchase_price)} · Current {formatMoney(p.current_price)}
                    </p>
                  </div>
                  {canEdit && (
                    <form action={setProductActive.bind(null, p.id, !p.is_active)}>
                      <button
                        type="submit"
                        className={
                          p.is_active
                            ? "text-sm text-slate-500 hover:text-red-600"
                            : "text-sm font-medium text-blue-700 hover:underline"
                        }
                      >
                        {p.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </div>
                {p.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{p.description}</p>}
                {canEdit && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit</summary>
                    <form action={updateProduct.bind(null, p.id)} className="mt-3 space-y-3">
                      <ProductFields product={p} assetTypes={assetTypes} />
                      <button type="submit" className={primaryButtonClass}>
                        Save product
                      </button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
