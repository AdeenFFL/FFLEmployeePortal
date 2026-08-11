import Link from "next/link";
import { Modal } from "@/components/modal";
import { renameRole } from "@/app/(protected)/admin/roles/actions";
import type { Role } from "@/types/database";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function RoleFormPanel({ closeHref, role }: { closeHref: string; role: Role }) {
  return (
    <Modal closeHref={closeHref} title="Edit Role">
      <form action={renameRole} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={role.id} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name *</span>
          <input name="name" required defaultValue={role.name} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={role.description ?? ""}
            className={inputClass}
          />
        </label>

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
