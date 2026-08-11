import { BellIcon, HelpCircleIcon } from "@/components/icons";
import { SUPPORT_EMAIL } from "@/lib/constants";

export function TopBar({ displayName }: { displayName: string }) {
  const initials =
    displayName
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="flex items-center justify-end gap-4 px-8 py-4">
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        aria-label="Help"
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <HelpCircleIcon className="h-5 w-5" />
      </a>
      {/* Static placeholder — no notifications feature/table exists yet. */}
      <button
        type="button"
        aria-label="Notifications"
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <BellIcon className="h-5 w-5" />
      </button>
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700"
        title={displayName}
      >
        {initials}
      </div>
    </div>
  );
}
