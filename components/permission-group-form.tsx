import { Modal } from "@/components/modal";
import { createPermissionGroup, renamePermissionGroup } from "@/app/(protected)/admin/permission-groups/actions";
import type { PermissionGroup } from "@/types/database";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function PermissionGroupFormPanel({
  mode,
  closeHref,
  group,
}: {
  mode: "new" | "edit";
  closeHref: string;
  group?: PermissionGroup;
}) {
  return (
    <Modal closeHref={closeHref} title={mode === "new" ? "New Permission Group" : "Rename Group"}>
      <form action={mode === "new" ? createPermissionGroup : renamePermissionGroup} className="flex flex-col gap-4">
        {mode === "edit" && group && <input type="hidden" name="id" value={group.id} />}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Module *</span>
          <input
            name="module"
            required
            defaultValue={group?.module ?? ""}
            readOnly={mode === "edit"}
            disabled={mode === "edit"}
            placeholder="e.g. hse, hr, it, fps"
            className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
          />
          {mode === "edit" ? (
            <span className="text-xs text-slate-400">
              Fixed at creation — a group can only ever contain permissions from its own module.
            </span>
          ) : (
            <span className="text-xs text-slate-400">
              Lowercase, matches the module&apos;s permission-key prefix (e.g. &quot;hse.report_incident&quot; → module &quot;hse&quot;).
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name *</span>
          <input name="name" required defaultValue={group?.name ?? ""} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={group?.description ?? ""}
            className={inputClass}
          />
        </label>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
