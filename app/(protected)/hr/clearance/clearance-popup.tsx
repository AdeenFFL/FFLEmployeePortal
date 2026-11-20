"use client";

import { useEffect, useState } from "react";
import { XIcon } from "@/components/icons";

// A card (Home, Raise a Ticket) that opens the employee's Clearance card in a popup instead of
// sending them to /profile. `children` is the server-rendered OffboardingCard (the same form or
// status as on the profile). Opened from local state: nothing goes into the URL. Closes with the
// ✕ button, a click outside, or Esc.
export function ClearancePopup({
  triggerClassName,
  trigger,
  children,
}: {
  triggerClassName: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`text-left ${triggerClassName}`}
      >
        {trigger}
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Clearance" className="relative w-full max-w-lg">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              autoFocus
              className="absolute right-4 top-4 z-10 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <XIcon className="h-5 w-5" />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
