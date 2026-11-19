"use client";

import { useState, useTransition } from "react";
import {
  forwardCase,
  cancelCase,
  refreshCaseOrg,
  skipSlot,
  unskipSlot,
  type ActionResult,
} from "../actions";

const secondaryButton =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

// Runs one action at a time and keeps its message inline (never in the URL). Each action
// revalidates this page, so a success simply re-renders it with the new status / snapshot.
function useCaseAction() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
        else onSuccess?.();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return { error, isPending, run };
}

export function CaseActions({
  caseId,
  status,
  canForward,
  ready,
}: {
  caseId: string;
  status: string;
  canForward: boolean;
  ready: boolean;
}) {
  const { error, isPending, run } = useCaseAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const canBeForwarded = canForward && status === "Submitted";
  const canBeCancelled = canForward && (status === "Submitted" || status === "In Clearance");

  return (
    <div className="flex flex-col items-end gap-3">
      {error && (
        <p className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled title="Coming soon" className={secondaryButton}>
          Print
        </button>
        {canBeCancelled && !cancelling && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setCancelling(true)}
            className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            Cancel request
          </button>
        )}
        {canBeForwarded && (
          <button
            type="button"
            disabled={isPending || !ready}
            title={ready ? undefined : "Fix the items in “Ready to forward?” first"}
            onClick={() => run(() => forwardCase(caseId))}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Working…" : "Forward for clearance"}
          </button>
        )}
      </div>

      {canBeForwarded && !ready && (
        <p className="text-xs text-slate-500">Fix the items above first.</p>
      )}

      {cancelling && (
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50/40 p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Reason for cancelling</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setCancelling(false);
                setReason("");
              }}
              className={secondaryButton}
            >
              Keep request
            </button>
            <button
              type="button"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                run(
                  () => cancelCase(caseId, reason),
                  () => {
                    setCancelling(false);
                    setReason("");
                  },
                )
              }
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Cancelling…" : "Confirm cancel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RefreshOrgButton({ caseId }: { caseId: string }) {
  const { error, isPending, run } = useCaseAction();

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => refreshCaseOrg(caseId))}
          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
        >
          {isPending ? "Updating…" : "Update site / department from profile"}
        </button>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// Skip (with a reason) or undo the skip of one part, for this request only. The reason is for HR;
// the employee only sees "Skipped". Undo is blocked while the part has no signer for this
// site / department, since the request would then be stuck waiting for nobody.
export function SlotSkipControl({
  caseId,
  slotKey,
  skipped,
  undoBlockedReason,
}: {
  caseId: string;
  slotKey: string;
  skipped: boolean;
  undoBlockedReason: string | null;
}) {
  const { error, isPending, run } = useCaseAction();
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 300;

  return (
    <div className="mt-1 flex flex-col gap-2">
      {skipped ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isPending || undoBlockedReason !== null}
            title={undoBlockedReason ?? undefined}
            onClick={() => run(() => unskipSlot(caseId, slotKey))}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Working…" : "Undo skip"}
          </button>
          {undoBlockedReason && <span className="text-xs text-slate-500">{undoBlockedReason}</span>}
        </div>
      ) : !skipping ? (
        <div>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setSkipping(true)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Skip this part
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700">
              Why is this part not needed? (HR only, the employee sees just “Skipped”)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setSkipping(false);
                setReason("");
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={isPending || !reasonOk}
              onClick={() =>
                run(
                  () => skipSlot(caseId, slotKey, reason),
                  () => {
                    setSkipping(false);
                    setReason("");
                  },
                )
              }
              className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Skipping…" : "Skip"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
