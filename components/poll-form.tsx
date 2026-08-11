import Link from "next/link";
import { Modal } from "@/components/modal";
import { createPoll } from "@/app/(protected)/company-updates/actions";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

const OPTION_COUNT = 6;

export function PollFormPanel({ basePath }: { basePath: string }) {
  return (
    <Modal closeHref={basePath} title="New Poll">
      <form action={createPoll} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Question *</span>
          <input name="question" required className={inputClass} />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Options</span>
          {Array.from({ length: OPTION_COUNT }, (_, i) => (
            <input
              key={i}
              name={`option_${i + 1}`}
              placeholder={`Option ${i + 1}${i < 2 ? " *" : ""}`}
              required={i < 2}
              className={inputClass}
            />
          ))}
          <p className="text-xs text-slate-400">
            At least 2 options are required. Leave the rest blank if not needed.
          </p>
        </div>

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
            Create Poll
          </button>
        </div>
      </form>
    </Modal>
  );
}
