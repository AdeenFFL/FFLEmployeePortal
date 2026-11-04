import { PRODUCT_UNITS } from "@/lib/it/procurement";
import type { ItProduct } from "@/types/database";
import { inputClass, labelClass } from "../../_components/ticket-ui";

export type AssetTypeOption = { id: string; name: string; is_active: boolean };

// One set of fields for both Add and Edit, grouped into short sections (title + hint on the
// left, fields on the right). Inactive asset types are only offered when the product already
// uses one, so editing doesn't silently drop the link.
export function ProductFields({
  product,
  assetTypes,
  categories,
}: {
  product?: ItProduct;
  assetTypes: AssetTypeOption[];
  categories: string[];
}) {
  const options = assetTypes.filter((t) => t.is_active || t.id === product?.asset_type_id);
  return (
    <div className="divide-y divide-slate-100">
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

      <Group title="Details" hint="What people see when they raise a demand.">
        <label className="block sm:col-span-2">
          <span className={labelClass}>
            Product name <span className="text-red-500">*</span>
          </span>
          <input
            name="productName"
            required
            defaultValue={product?.product_name ?? ""}
            placeholder="e.g. Dell Latitude 5440"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Category</span>
          <input
            name="category"
            list="product-categories"
            defaultValue={product?.category ?? ""}
            placeholder="e.g. Laptop, Toner, Cable"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Unit</span>
          <input name="unit" list="product-units" defaultValue={product?.unit ?? "Each"} className={inputClass} />
        </label>
      </Group>

      <Group title="Price" hint="Current price is used to estimate a demand's total.">
        <MoneyInput name="purchasePrice" label="Purchase price" value={product?.purchase_price} />
        <MoneyInput name="currentPrice" label="Current price" value={product?.current_price} />
      </Group>

      <Group title="Tracking" hint="Pick an asset type if each unit received should be registered as an asset.">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Asset type</span>
          <select name="assetTypeId" defaultValue={product?.asset_type_id ?? ""} className={inputClass}>
            <option value="">None — consumable / service (goes into stock)</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Specification" hint="Optional — model, size, configuration.">
        <label className="block sm:col-span-2">
          <span className="sr-only">Description / specification</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={product?.description ?? ""}
            placeholder="e.g. Core i5, 16 GB RAM, 512 GB SSD, 14-inch"
            className={inputClass}
          />
        </label>
      </Group>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 px-6 py-5 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function MoneyInput({ name, label, value }: { name: string; label: string; value?: number | null }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
          Rs
        </span>
        <input
          name={name}
          inputMode="decimal"
          defaultValue={value ?? ""}
          placeholder="0.00"
          className={`${inputClass} pl-10 tabular-nums`}
        />
      </span>
    </label>
  );
}
