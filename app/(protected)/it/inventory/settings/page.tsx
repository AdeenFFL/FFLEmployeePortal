import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { AssetType, AssetValueType, AssetValueTypeName } from "@/types/database";
import { fetchOrgUnits } from "@/lib/it/ticket-data";
import { fixedAssetTypeIds, isFixedAsset } from "@/lib/it/stock";
import { FormMessage, inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";
import { FormDrawer } from "../_components/drawer";
import {
  createAssetType,
  deleteAssetType,
  saveAssetValueType,
  saveStockMinimum,
  toggleAssetTypeActive,
  updateAssetType,
} from "./actions";

const VALUE_TYPE_NAMES: AssetValueTypeName[] = ["New", "Old"];
const BASE_PATH = "/it/inventory/settings";
const MAX_YEARS_SHOWN = 6;

const VALUE_HINTS: Record<AssetValueTypeName, string> = {
  New: "Bought new from a vendor.",
  Old: "Second-hand, transferred or re-used.",
};

// INV-01 Inventory settings (talha_it_0002): asset types, the New / Old value rules and minimum
// stock levels (javaria_it_0023), on one page. Adding / editing happens in a slide-over (?compose=new, ?editType=…, ?editValue=…).
export default async function InventorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kind?: string;
    compose?: string;
    editType?: string;
    editValue?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === "Fixed" || sp.kind === "Consumable" ? sp.kind : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const supabase = await createClient();

  const [
    { data: assetTypes },
    { data: valueTypes },
    { data: canEdit },
    { data: assetRows },
    { data: productRows },
    { data: minimumRows },
    fixedTypes,
    { sites, nameById: siteName },
  ] = await Promise.all([
    supabase
      .schema("it")
      .from("asset_types")
      .select("id, name, classification, description, is_active")
      .order("name"),
    supabase.schema("it").from("asset_value_types").select("*"),
    supabase.rpc("has_permission", { p_permission_key: "it.inventory_settings.update" }),
    // How many live assets use each type — deleting is only possible at 0.
    supabase.schema("it").from("assets").select("asset_type_id").is("deleted_at", null),
    supabase.schema("it").from("products").select("id, product_name, unit, asset_type_id, is_active").is("service_category", null).order("product_name"),
    supabase.schema("it").from("stock_minimums").select("product_id, site_id, min_quantity"),
    fixedAssetTypeIds(supabase),
    fetchOrgUnits(supabase),
  ]);
  const consumables = (productRows ?? []).filter((p) => !isFixedAsset(p, fixedTypes));
  const productName = new Map(consumables.map((p) => [p.id, p.product_name]));

  const types = (assetTypes ?? []) as Pick<AssetType, "id" | "name" | "classification" | "description" | "is_active">[];
  const usage = new Map<string, number>();
  for (const a of assetRows ?? []) usage.set(a.asset_type_id, (usage.get(a.asset_type_id) ?? 0) + 1);
  const counts = {
    all: types.length,
    Fixed: types.filter((t) => t.classification === "Fixed").length,
    Consumable: types.filter((t) => t.classification === "Consumable").length,
  };
  const shown = types.filter(
    (t) =>
      (kind === "all" || t.classification === kind) &&
      (!q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)),
  );

  const valueTypeByName = new Map<string, AssetValueType>((valueTypes ?? []).map((v) => [v.name, v]));
  const editingType = canEdit ? types.find((t) => t.id === sp.editType) : undefined;
  const editingValue =
    canEdit && VALUE_TYPE_NAMES.includes(sp.editValue as AssetValueTypeName)
      ? (sp.editValue as AssetValueTypeName)
      : null;

  const typesHref = (next: { kind?: string }) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    const k = next.kind ?? kind;
    if (k !== "all") p.set("kind", k);
    const s = p.toString();
    return s ? `${BASE_PATH}?${s}` : BASE_PATH;
  };

  return (
    <div className="mx-auto max-w-5xl py-6">
      <PageHeader
        title="Inventory settings"
        description="Asset types used across the register, and how assets lose value over time."
        action={
          canEdit ? (
            <Link href={`${BASE_PATH}?compose=new`} className={primaryButtonClass}>
              + Add asset type
            </Link>
          ) : undefined
        }
      />


      <FormMessage error={sp.error} notice={sp.notice} />

      <section aria-labelledby="asset-types">
          <h2 id="asset-types" className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
            Asset types
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{counts.all}</span>
          </h2>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <form method="get" className="relative w-full max-w-sm">
              {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Search asset types"
                aria-label="Search asset types"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </form>
            <div className="flex gap-2" role="group" aria-label="Type">
              {(["all", "Fixed", "Consumable"] as const).map((k) => (
                <Link
                  key={k}
                  href={typesHref({ kind: k })}
                  aria-current={kind === k ? "true" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    kind === k
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {k === "all" ? "All" : k}{" "}
                  <span className={kind === k ? "text-slate-300" : "text-slate-400"}>{counts[k]}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {shown.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">
                {types.length === 0 ? "No asset types yet." : "No asset types match."}
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Assets</th>
                    <th className="px-4 py-3">Status</th>
                    {canEdit && <th className="px-5 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((t) => {
                    const used = usage.get(t.id) ?? 0;
                    return (
                      <tr key={t.id} className={t.is_active ? "" : "bg-slate-50/60"}>
                        <td className="px-5 py-3.5">
                          <p className={`font-medium ${t.is_active ? "text-slate-900" : "text-slate-500"}`}>{t.name}</p>
                          {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              t.classification === "Fixed" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {t.classification}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-slate-600">{used || "—"}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 text-sm ${
                              t.is_active ? "text-emerald-700" : "text-slate-400"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`h-1.5 w-1.5 rounded-full ${t.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                            />
                            {t.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-end gap-3">
                              <Link
                                href={`${BASE_PATH}?editType=${t.id}`}
                                className="text-sm font-medium text-blue-700 hover:underline"
                              >
                                Edit
                              </Link>
                              <details className="relative">
                                <summary
                                  aria-label={`More actions for ${t.name}`}
                                  className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
                                >
                                  ···
                                </summary>
                                <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg">
                                  <form action={toggleAssetTypeActive.bind(null, t.id, !t.is_active)}>
                                    <button
                                      type="submit"
                                      className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                                    >
                                      {t.is_active ? "Deactivate" : "Activate"}
                                    </button>
                                  </form>
                                  <form action={deleteAssetType.bind(null, t.id)}>
                                    <button
                                      type="submit"
                                      disabled={used > 0}
                                      className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                                    >
                                      Delete
                                    </button>
                                  </form>
                                  <p className="px-3 pb-2 text-xs text-slate-400">
                                    {used > 0
                                      ? `Used by ${used} asset${used === 1 ? "" : "s"} — deactivate instead.`
                                      : "Only possible while no asset uses this type."}
                                  </p>
                                </div>
                              </details>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Fixed assets are tracked one by one with a tag and serial number. Consumables are counted by quantity.
          </p>
      </section>

      <section id="values" aria-labelledby="values-title" className="mt-10 border-t border-slate-200 pt-8">
        <h2 id="values-title" className="text-lg font-semibold text-slate-900">
          Value &amp; depreciation
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Every asset is valued as New or Old. These rules set its depreciation and current value.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {VALUE_TYPE_NAMES.map((name) => {
            const v = valueTypeByName.get(name);
            return (
              <article key={name} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">{name} assets</p>
                    {v ? (
                      <p className="mt-0.5 text-3xl font-semibold tabular-nums text-slate-900">
                        {Number(v.depreciation_percentage)}%
                        <span className="ml-1.5 text-base font-normal text-slate-500">per year</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-amber-700">Not set up yet</p>
                    )}
                  </div>
                  {canEdit && (
                    <Link
                      href={`${BASE_PATH}?editValue=${name}`}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {v ? "Edit" : "Set up"}
                    </Link>
                  )}
                </div>

                {v ? (
                  <>
                    <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-slate-500">Method</dt>
                        <dd className="font-medium text-slate-900">
                          {v.depreciation_method === "Straight Line" ? "Straight line" : "Reducing balance"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Useful life</dt>
                        <dd className="font-medium text-slate-900">
                          {v.useful_life_years ? `${v.useful_life_years} year${v.useful_life_years === 1 ? "" : "s"}` : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-5 text-sm text-slate-500">Value left at the end of each year</p>
                    <ul className="mt-2 space-y-1.5">
                      {valueLeft(v).map(({ year, left }) => (
                        <li key={year} className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-3 text-sm">
                          <span className="text-slate-600">Year {year}</span>
                          <span className="h-1.5 rounded-full bg-slate-100">
                            <span
                              className="block h-1.5 rounded-full bg-blue-600"
                              style={{ width: `${Math.max(0, Math.min(100, left))}%` }}
                            />
                          </span>
                          <span className="text-right tabular-nums text-slate-700">{formatPercent(left)}</span>
                        </li>
                      ))}
                    </ul>
                    {v.description && <p className="mt-3 text-xs text-slate-500">{v.description}</p>}
                  </>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    {VALUE_HINTS[name]} Set the yearly rate so these assets get a current value.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section id="minimums" aria-labelledby="minimums-title" className="mt-10 border-t border-slate-200 pt-8">
        <h2 id="minimums-title" className="text-lg font-semibold text-slate-900">
          Minimum stock levels
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          At or below this count a consumable shows as running low at that site. Without one here, the product&apos;s own
          reorder level applies.
        </p>
        {canEdit && (
          <form action={saveStockMinimum} className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
            <label className="block">
              <span className={labelClass}>Consumable</span>
              <select name="productId" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose
                </option>
                {consumables
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.product_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Site</span>
              <select name="siteId" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose
                </option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Minimum</span>
              <input name="minQuantity" type="number" min={0} step={1} required className={inputClass} />
            </label>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </form>
        )}
        {(minimumRows ?? []).length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No site minimums set yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Consumable</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3 text-right">Minimum</th>
                  {canEdit && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(minimumRows ?? []).map((m) => (
                  <tr key={`${m.product_id}:${m.site_id}`}>
                    <td className="px-5 py-3 text-slate-900">{productName.get(m.product_id) ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{siteName.get(m.site_id) ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{m.min_quantity}</td>
                    {canEdit && (
                      <td className="px-5 py-3 text-right">
                        <form action={saveStockMinimum}>
                          <input type="hidden" name="productId" value={m.product_id} />
                          <input type="hidden" name="siteId" value={m.site_id} />
                          <input type="hidden" name="minQuantity" value="" />
                          <button type="submit" className="text-sm font-medium text-slate-500 hover:text-red-600">
                            Remove
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (sp.compose === "new" || editingType) && (
        <FormDrawer
          key={editingType?.id ?? "new"}
          closeHref={BASE_PATH}
          title={editingType ? `Edit ${editingType.name}` : "Add asset type"}
          description="Shown when registering assets and products."
          action={editingType ? updateAssetType.bind(null, editingType.id) : createAssetType}
          submitLabel={editingType ? "Save changes" : "Save asset type"}
        >
          <AssetTypeFields type={editingType} />
        </FormDrawer>
      )}

      {editingValue && (
        <FormDrawer
          key={editingValue}
          closeHref={`${BASE_PATH}#values`}
          title={`${editingValue} assets`}
          description={VALUE_HINTS[editingValue]}
          action={saveAssetValueType.bind(null, editingValue)}
          submitLabel="Save rules"
        >
          <ValueTypeFields value={valueTypeByName.get(editingValue)} />
        </FormDrawer>
      )}
    </div>
  );
}

// Share of the purchase value left at the end of each year (salvage ignored): straight line takes
// the same share off every year, reducing balance takes the rate off what is left.
function valueLeft(v: AssetValueType) {
  const rate = Number(v.depreciation_percentage) / 100;
  const years = Math.min(v.useful_life_years ?? MAX_YEARS_SHOWN, MAX_YEARS_SHOWN);
  return Array.from({ length: years }, (_, i) => {
    const year = i + 1;
    let left =
      v.depreciation_method === "Reducing Balance" ? 100 * Math.pow(1 - rate, year) : 100 - rate * 100 * year;
    // A straight-line rate that doesn't divide evenly (33.33% × 3) still ends at 0 after the useful life.
    if (v.useful_life_years && year >= v.useful_life_years && v.depreciation_method === "Straight Line") left = 0;
    return { year, left: Math.max(0, left) };
  });
}

function formatPercent(value: number) {
  return `${Math.round(value * 100) / 100}%`;
}

function AssetTypeFields({
  type,
}: {
  type?: Pick<AssetType, "name" | "classification" | "description" | "is_active">;
}) {
  const classification = type?.classification ?? "Fixed";
  return (
    <>
      <label className="block">
        <span className={labelClass}>Name</span>
        <input name="name" required defaultValue={type?.name ?? ""} placeholder="e.g. Scanner" className={inputClass} />
      </label>

      <fieldset>
        <legend className={labelClass}>Type</legend>
        <div className="space-y-2">
          {(
            [
              ["Fixed", "Tracked one by one with a tag and serial number"],
              ["Consumable", "Counted by quantity, like toner or cables"],
            ] as const
          ).map(([value, hint]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/50"
            >
              <input
                type="radio"
                name="classification"
                value={value}
                defaultChecked={classification === value}
                className="mt-1 accent-blue-600"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">{value}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className={labelClass}>
          Description <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={3}
          defaultValue={type?.description ?? ""}
          placeholder="e.g. Barcode and document scanners"
          className={inputClass}
        />
      </label>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
        <span>
          <span className="block text-sm font-medium text-slate-900">Active</span>
          <span className="block text-xs text-slate-500">Inactive types stay on old assets but can&apos;t be picked</span>
        </span>
        <input type="checkbox" name="is_active" defaultChecked={type?.is_active ?? true} className="h-5 w-5 accent-blue-600" />
      </label>
    </>
  );
}

function ValueTypeFields({ value }: { value?: AssetValueType }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Depreciation % per year</span>
          <input
            name="depreciation_percentage"
            type="number"
            min={0}
            max={100}
            step="0.01"
            required
            defaultValue={value?.depreciation_percentage ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Useful life (years)</span>
          <input
            name="useful_life_years"
            type="number"
            min={1}
            step={1}
            defaultValue={value?.useful_life_years ?? ""}
            className={inputClass}
          />
        </label>
      </div>
      <fieldset>
        <legend className={labelClass}>Method</legend>
        <div className="space-y-2">
          {(
            [
              ["Straight Line", "Same amount off every year"],
              ["Reducing Balance", "Percentage off the remaining value each year"],
            ] as const
          ).map(([method, hint]) => (
            <label
              key={method}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-300 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50/50"
            >
              <input
                type="radio"
                name="depreciation_method"
                value={method}
                defaultChecked={(value?.depreciation_method ?? "Straight Line") === method}
                className="mt-1 accent-blue-600"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">{method}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className={labelClass}>
          Description <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <input name="description" defaultValue={value?.description ?? ""} className={inputClass} />
      </label>
    </>
  );
}
