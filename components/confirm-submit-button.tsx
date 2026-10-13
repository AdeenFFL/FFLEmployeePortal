"use client";

import type { ReactNode } from "react";

const TONE_CLASSES = {
  neutral: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
  danger: "text-red-500 hover:bg-red-50 hover:text-red-600",
};

// Same visual language as components/icon-button.tsx's IconButton, but for the rare destructive
// action severe enough to warrant a native confirm() — specifically hardDeleteUser(), which is
// irreversible and cascades across every module (see 0022_cascade_person_deletes.sql). Most
// destructive actions in this app (deleteRole, deleteCategory, revokeInvitation) don't confirm;
// this one does because it silently deletes other people's records too, not just the target
// person's own data.
export function ConfirmSubmitButton({
  icon,
  label,
  confirmMessage,
  tone = "danger",
}: {
  icon: ReactNode;
  label: string;
  confirmMessage: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="submit"
      title={label}
      aria-label={label}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${TONE_CLASSES[tone]}`}
    >
      {icon}
    </button>
  );
}
