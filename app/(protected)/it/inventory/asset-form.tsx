"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Asset } from "@/types/database";
import type { AssetFormState } from "./actions";
import { inputClass, labelClass } from "../_components/ticket-ui";

type Option = { id: string; name: string };

// Shared by Add and Edit — the caller passes the Server Action, so this component never decides
// what saving means. `asset` pre-fills the fields when editing.
export function AssetForm({
  action,
  assetTypes,
  companies,
  sites,
  submitLabel,
  asset,
  cancelHref = "/it/inventory",
}: {
  action: (state: AssetFormState, formData: FormData) => Promise<AssetFormState>;
  assetTypes: Option[];
  companies: Option[];
  sites: Option[];
  submitLabel: string;
  asset?: Asset;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      {state.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>Asset tag *</label>
          {/* No enforced format (decision 5): the placeholder is only a hint. */}
          <input
            name="asset_tag"
            required
            defaultValue={asset?.asset_tag ?? ""}
            placeholder="e.g. FFL-LAP-001"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Asset name *</label>
          <input
            name="asset_name"
            required
            defaultValue={asset?.asset_name ?? ""}
            placeholder="e.g. Dell Latitude 5440"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Asset type *</label>
          <select
            name="asset_type_id"
            required
            defaultValue={asset?.asset_type_id ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              Select a type
            </option>
            {assetTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Serial number *</label>
          <input
            name="serial_number"
            required
            defaultValue={asset?.serial_number ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Company *</label>
          <select
            name="company_id"
            required
            defaultValue={asset?.company_id ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              Select a company
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Manufacturer</label>
          <input
            name="manufacturer"
            defaultValue={asset?.manufacturer ?? ""}
            placeholder="e.g. Dell"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Model number</label>
          <input name="model_number" defaultValue={asset?.model_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Site</label>
          <select name="site_id" defaultValue={asset?.site_id ?? ""} className={inputClass}>
            <option value="">No site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Condition</label>
          <input
            name="condition"
            defaultValue={asset?.condition ?? ""}
            placeholder="e.g. New, Good, Fair"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Purchase date</label>
          <input
            name="purchase_date"
            type="date"
            defaultValue={asset?.purchase_date ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Warranty expiry</label>
          <input
            name="warranty_expiry"
            type="date"
            defaultValue={asset?.warranty_expiry ?? ""}
            className={inputClass}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea name="notes" rows={3} defaultValue={asset?.notes ?? ""} className={inputClass} />
        </div>
      </div>

      {!asset && <p className="text-xs text-slate-500">New assets start as Unassigned.</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
