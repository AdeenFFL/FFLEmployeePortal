"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { XIcon } from "@/components/icons";
import { useDismissable } from "@/components/use-dismissable";

// Right-hand slide-over with a form: title + hint at the top, fields in the middle, Cancel / Save
// pinned to the bottom. Opened by a URL param (like Modal) so it works without client state.
export function FormDrawer({
  closeHref,
  title,
  description,
  action,
  submitLabel,
  children,
}: {
  closeHref: string;
  title: string;
  description?: string;
  action: (formData: FormData) => void;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const { visible, close } = useDismissable(closeHref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/30" onClick={close} />
      <form action={action} className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={close} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <Submit label={submitLabel} />
        </div>
      </form>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}
