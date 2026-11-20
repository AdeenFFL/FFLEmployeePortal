"use client";

import { useState, useTransition } from "react";
import { confirmDataReceived } from "./actions";

// Two clicks on purpose: the confirmation is final and fills a line on the clearance form.
export function ConfirmDataReceivedButton({ caseId }: { caseId: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmDataReceived(caseId);
        if (result.error) setError(result.error);
        // On success the page re-renders and shows "Confirmed on …".
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {!asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Confirm data received
        </button>
      ) : (
        <div className="flex max-w-xs flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-slate-700">
          <p>
            I confirm I have received the complete data and work handover from this employee.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setAsking(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Not yet
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleConfirm}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {isPending ? "Confirming…" : "Yes, confirm"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
