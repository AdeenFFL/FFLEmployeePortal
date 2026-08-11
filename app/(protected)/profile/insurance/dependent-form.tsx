import Link from "next/link";
import { addOrUpdateDependent } from "./actions";

type DependentFormValues = {
  id?: string;
  name: string;
  relationship: string;
  cnic_or_bform: string | null;
  date_of_birth: string | null;
};

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function DependentFormPanel({
  mode,
  initialValues,
}: {
  mode: "new" | "edit";
  initialValues: DependentFormValues;
}) {
  return (
    <div className="fixed inset-0 z-10">
      <div className="absolute inset-0 bg-slate-900/40" />
      <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto rounded-l-xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {mode === "new" ? "Add Dependent" : "Edit Dependent"}
          </h2>
          <Link
            href="/profile/insurance"
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Close
          </Link>
        </div>

        <form action={addOrUpdateDependent} className="flex flex-col gap-4">
          {mode === "edit" && initialValues.id && (
            <input type="hidden" name="dependent_id" value={initialValues.id} />
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Name</span>
            <input
              name="name"
              required
              defaultValue={initialValues.name}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Relationship</span>
            <input
              name="relationship"
              required
              defaultValue={initialValues.relationship}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">CNIC / B-form</span>
            <input
              name="cnic_or_bform"
              defaultValue={initialValues.cnic_or_bform ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Date of Birth</span>
            <input
              name="date_of_birth"
              type="date"
              defaultValue={initialValues.date_of_birth ?? ""}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Supporting Document</span>
            <input name="supporting_document" type="file" className="text-sm" />
            {mode === "edit" && (
              <span className="text-xs text-slate-400">
                Leave blank to keep the existing document.
              </span>
            )}
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <Link
              href="/profile/insurance"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
