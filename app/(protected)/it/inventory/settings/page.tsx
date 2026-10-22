import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Modal } from "@/components/modal";
import type { AssetValueType, AssetValueTypeName } from "@/types/database";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../_components/ticket-ui";
import {
  createAssetType,
  updateAssetType,
  toggleAssetTypeActive,
  deleteAssetType,
  saveAssetValueType,
} from "./actions";

const VALUE_TYPE_NAMES: AssetValueTypeName[] = ["New", "Old"];
const BASE_PATH = "/it/inventory/settings";

function ClassificationSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="classification" defaultValue={defaultValue ?? "Fixed"} required className={inputClass}>
      <option value="Fixed">Fixed</option>
      <option value="Consumable">Consumable</option>
    </select>
  );
}

export default async function InventorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; editType?: string; editValue?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: assetTypes }, { data: valueTypes }, { data: canEdit }] = await Promise.all([
    supabase
      .schema("it")
      .from("asset_types")
      .select("id, name, classification, description, is_active")
      .order("name"),
    supabase
      .schema("it")
      .from("asset_value_types")
      .select("*"),
    supabase.rpc("has_permission", { p_permission_key: "it.inventory_settings.update" }),
  ]);

  const valueTypeByName = new Map<string, AssetValueType>(
    (valueTypes ?? []).map((v) => [v.name, v]),
  );
  const editingType = canEdit
    ? (assetTypes ?? []).find((t) => t.id === sp.editType)
    : undefined;

  return (
    <div className="py-6">
      <PageHeader
        title="Inventory Settings"
        description="Asset types used across the asset register, and the depreciation rules for new and old assets."
        action={
          canEdit ? (
            <Link href={`${BASE_PATH}?compose=new`} className={primaryButtonClass}>
              + Add Asset Type
            </Link>
          ) : undefined
        }
      />

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Asset Types</h2>
        <p className="mb-4 text-sm text-slate-500">
          Fixed assets are tracked individually by tag and serial number. Consumables are tracked as
          stock quantities.
        </p>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {(assetTypes ?? []).length === 0 && (
            <p className="p-5 text-sm text-slate-400">No asset types yet.</p>
          )}
          <ul className="divide-y divide-slate-100">
            {(assetTypes ?? []).map((type) => {
              const toggleAction = toggleAssetTypeActive.bind(null, type.id, !type.is_active);
              const deleteAction = deleteAssetType.bind(null, type.id);

              return (
                <li key={type.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{type.name}</p>
                      {type.description && (
                        <p className="text-sm text-slate-500">{type.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          type.classification === "Fixed"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {type.classification}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          type.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {type.is_active ? "Active" : "Inactive"}
                      </span>
                      {canEdit && (
                        <>
                          <Link href={`${BASE_PATH}?editType=${type.id}`} className={secondaryButtonClass}>
                            Edit
                          </Link>
                          <form action={toggleAction}>
                            <button type="submit" className={secondaryButtonClass}>
                              {type.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </form>
                          <form action={deleteAction}>
                            <button
                              type="submit"
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {canEdit && sp.compose === "new" && (
        <Modal key={Date.now()} closeHref={BASE_PATH} title="Add Asset Type">
          <form action={createAssetType} className="space-y-3">
            <div>
              <label className={labelClass}>Name</label>
              <input name="name" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Classification</label>
              <ClassificationSelect />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input name="description" className={inputClass} />
            </div>
            <button type="submit" className={primaryButtonClass}>
              Add Asset Type
            </button>
          </form>
        </Modal>
      )}

      {canEdit && editingType && (
        <Modal key={Date.now()} closeHref={BASE_PATH} title={`Edit ${editingType.name}`}>
          <form action={updateAssetType.bind(null, editingType.id)} className="space-y-3">
            <div>
              <label className={labelClass}>Name</label>
              <input name="name" defaultValue={editingType.name} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Classification</label>
              <ClassificationSelect defaultValue={editingType.classification} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input
                name="description"
                defaultValue={editingType.description ?? ""}
                className={inputClass}
              />
            </div>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </form>
        </Modal>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Asset Value Types</h2>
        <p className="mb-4 text-sm text-slate-500">
          Every asset is valued as New or Old. These rules drive its depreciation and current value.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {VALUE_TYPE_NAMES.map((name) => {
            const valueType = valueTypeByName.get(name);

            return (
              <div key={name} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{name}</p>
                  {!valueType && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Not configured
                    </span>
                  )}
                </div>

                {valueType ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Depreciation</dt>
                      <dd className="text-slate-900">{valueType.depreciation_percentage}%</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Useful life</dt>
                      <dd className="text-slate-900">
                        {valueType.useful_life_years ? `${valueType.useful_life_years} years` : "—"}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500">Method</dt>
                      <dd className="text-slate-900">{valueType.depreciation_method}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-400">Not configured yet.</p>
                )}

                {canEdit && (
                  <Link href={`${BASE_PATH}?editValue=${name}`} className={`${secondaryButtonClass} mt-4 inline-block`}>
                    {valueType ? `Edit ${name}` : `Configure ${name}`}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {canEdit && VALUE_TYPE_NAMES.includes(sp.editValue as AssetValueTypeName) && (
        <Modal key={Date.now()} closeHref={BASE_PATH} title={`Edit ${sp.editValue}`}>
          {(() => {
            const name = sp.editValue as AssetValueTypeName;
            const valueType = valueTypeByName.get(name);
            return (
              <form action={saveAssetValueType.bind(null, name)} className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Depreciation %</label>
                  <input
                    name="depreciation_percentage"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    defaultValue={valueType?.depreciation_percentage ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Useful life (years)</label>
                  <input
                    name="useful_life_years"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={valueType?.useful_life_years ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Depreciation method</label>
                  <select
                    name="depreciation_method"
                    defaultValue={valueType?.depreciation_method ?? "Straight Line"}
                    className={inputClass}
                  >
                    <option value="Straight Line">Straight Line</option>
                    <option value="Reducing Balance">Reducing Balance</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Description</label>
                  <input
                    name="description"
                    defaultValue={valueType?.description ?? ""}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <button type="submit" className={primaryButtonClass}>
                    Save {name}
                  </button>
                </div>
              </form>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
