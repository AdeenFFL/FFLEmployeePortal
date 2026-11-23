"use client";

import { useEffect, useState } from "react";

const SHOW_MS = 4000;

export function signedFlagKey(caseId: string, slotKey: string) {
  return `clearance-signed:${caseId}/${slotKey}`;
}

// A short green "Signed ✓" pop-up, shown once right after this person signs this part. The form
// sets a flag in sessionStorage before the page re-renders into the locked view; this reads and
// clears it. Storage can be blocked (private window): then there is simply no pop-up.
export function SignedToast({
  caseId,
  slotKey,
}: {
  caseId: string;
  slotKey: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = signedFlagKey(caseId, slotKey);
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(key) === "1";
    } catch {
      flagged = false;
    }
    if (!flagged) return;
    // The flag is removed only when the pop-up really opens: in development React runs this
    // effect twice (and cancels the first run's timers), so removing it here would lose it.
    const open = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
      setShow(true);
    }, 0);
    const close = window.setTimeout(() => setShow(false), SHOW_MS);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, [caseId, slotKey]);

  if (!show) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
    >
      <span aria-hidden="true">✓</span> Signed. This part is now locked.
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Close"
        className="ml-2 text-white/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
