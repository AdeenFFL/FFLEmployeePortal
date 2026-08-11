import Link from "next/link";
import { Modal } from "@/components/modal";
import { createOrUpdateAnnouncement } from "@/app/(protected)/company-updates/actions";
import type { Announcement } from "@/types/database";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export function AnnouncementFormPanel({
  basePath,
  mode,
  initialValues,
}: {
  basePath: string;
  mode: "new" | "edit";
  initialValues: Announcement | null;
}) {
  const title = mode === "new" ? "New Announcement" : "Edit Announcement";

  return (
    <Modal closeHref={basePath} title={title}>
      <form action={createOrUpdateAnnouncement} className="flex flex-col gap-4">
        {mode === "edit" && initialValues && (
          <input type="hidden" name="id" value={initialValues.id} />
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Title *</span>
          <input
            name="title"
            required
            defaultValue={initialValues?.title ?? ""}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Body *</span>
          <textarea
            name="body"
            required
            rows={5}
            defaultValue={initialValues?.body ?? ""}
            className={inputClass}
          />
        </label>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-slate-700">Pin to top</span>
            <span className="block text-xs text-slate-400">
              Pinned announcements always sort above unpinned ones.
            </span>
          </span>
          <input
            type="checkbox"
            name="is_pinned"
            defaultChecked={initialValues?.is_pinned ?? false}
            className="peer sr-only"
          />
          <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-200 transition-colors peer-checked:bg-blue-600">
            <span className="inline-block h-4 w-4 translate-x-1 transform rounded-full bg-white shadow transition-transform peer-checked:translate-x-6" />
          </span>
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
            Save Announcement
          </button>
        </div>
      </form>
    </Modal>
  );
}
