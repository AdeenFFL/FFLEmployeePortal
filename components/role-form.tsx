import Link from "next/link";
import { Modal } from "@/components/modal";
import { renameRole, createRole } from "@/app/(protected)/admin/roles/actions";
import type { Role } from "@/types/database";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function RoleFormPanel({
  closeHref,
  mode,
  role,
}: {
  closeHref: string;
  mode: "new" | "edit";
  role: Role | null;
}) {
  const action = mode === "new" ? createRole : renameRole;
  const title = mode === "new" ? "Add New Role" : "Edit Role";

  return (
    <Modal closeHref={closeHref} title={title}>
      <form action={action} className="flex flex-col gap-4">
        {mode === "edit" && role && <input type="hidden" name="id" value={role.id} />}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name *</span>
          <input name="name" required defaultValue={role?.name ?? ""} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={role?.description ?? ""}
            className={inputClass}
          />
        </label>

        {mode === "new" && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Starts with no permissions granted. Set Module Access below, then configure its
            fine-grained permissions from each module's own settings screen.
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Link
            href={closeHref}
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
    </Modal>
  );
}
