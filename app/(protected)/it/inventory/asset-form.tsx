"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AssetFormState } from "./actions";

type Option = { id: string; name: string };

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-700";

// Shared by Add (and later Edit) — the caller passes the Server Action, so this component never
// decides what saving means.
export function AssetForm({
  action,
  assetTypes,
  companies,
  sites,
  submitLabel,
}: {
  action: (state: AssetFormState, formData: FormData) => Promise<AssetFormState>;
  assetTypes: Option[];
  companies: Option[];
  sites: Option[];
  submitLabel: string;
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
        <div>
          <label className={labelClass}>Asset name *</label>
          <input name="asset_name" required placeholder="e.g. Dell Latitude 5440" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Asset type *</label>
          <select name="asset_type_id" required defaultValue="" className={inputClass}>
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
          <input name="serial_number" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Company *</label>
          <select name="company_id" required defaultValue="" className={inputClass}>
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
          <input name="manufacturer" placeholder="e.g. Dell" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Model number</label>
          <input name="model_number" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Site</label>
          {/* org_units is admin-readable only for now, so non-admins get no site choices —
              07-it-inventory-plan.md, Phase 2 decision (a). */}
          <select name="site_id" defaultValue="" disabled={sites.length === 0} className={inputClass}>
            <option value="">{sites.length === 0 ? "Not available yet" : "No site"}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Condition</label>
          <input name="condition" placeholder="e.g. New, Good, Fair" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Purchase date</label>
          <input name="purchase_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Warranty expiry</label>
          <input name="warranty_expiry" type="date" className={inputClass} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea name="notes" rows={3} className={inputClass} />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        The asset tag is created automatically when you save. New assets start as Unassigned.
      </p>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link
          href="/it/inventory"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
