import Link from "next/link";
import { Modal } from "@/components/modal";
import { createOrUpdateOrgUnit } from "@/lib/admin/org-units";
import type { OrgUnit, OrgUnitType } from "@/types/database";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function OrgUnitFormPanel({
  type,
  basePath,
  mode,
  initialValues,
}: {
  type: OrgUnitType;
  basePath: string;
  mode: "new" | "edit";
  initialValues: OrgUnit | null;
}) {
  const boundAction = createOrUpdateOrgUnit.bind(null, type);
  const title = mode === "new" ? `Add New ${type}` : `Edit ${type}`;

  return (
    <Modal closeHref={basePath} title={title}>
      <form action={boundAction} className="flex flex-col gap-4">
        {mode === "edit" && initialValues && (
          <input type="hidden" name="id" value={initialValues.id} />
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name *</span>
          <input
            name="name"
            required
            defaultValue={initialValues?.name ?? ""}
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Short Code *</span>
            <input
              name="short_code"
              required
              defaultValue={initialValues?.short_code ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Type *</span>
            {/* Fixed at creation — which page (Departments/Sites) you're on decides the type.
                Shown here for visual parity only; not a functional control. */}
            <select disabled value={type} className={`${inputClass} bg-slate-50 text-slate-500`}>
              <option value={type}>{type}</option>
            </select>
          </label>
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-slate-700">Active Status</span>
            <span className="block text-xs text-slate-400">
              Determines if this entry is visible in system dropdowns.
            </span>
          </span>
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initialValues ? initialValues.is_active : true}
            className="peer sr-only"
          />
          <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-200 transition-colors peer-checked:bg-blue-600">
            <span className="inline-block h-4 w-4 translate-x-1 transform rounded-full bg-white shadow transition-transform peer-checked:translate-x-6" />
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Internal Notes</span>
          <textarea
            name="description"
            rows={3}
            placeholder="Add any relevant notes here..."
            defaultValue={initialValues?.description ?? ""}
            className={inputClass}
          />
        </label>

        <div className="mt-2 flex justify-end gap-2">
          <Link
            href={basePath}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save Entry
          </button>
        </div>
      </form>
    </Modal>
  );
}
