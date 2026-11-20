"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnClearanceAsset } from "./actions";

export type OpenAsset = {
  assignment_id: string;
  asset_tag: string;
  asset_name: string;
  serial_number: string | null;
  // Already formatted on the server.
  assignedOn: string;
  assigned_condition: string | null;
  asset_status: string;
};

// Same choices as hr.clearance_return_asset accepts.
const NEW_STATUSES = [
  { value: "Unassigned", label: "Returned: back in stock (Unassigned)" },
  { value: "Retired", label: "Returned: retire it (Retired)" },
  { value: "Lost", label: "Not returned: mark it Lost" },
] as const;

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// The assets the leaving employee still holds. The IT signer returns each one (or marks it Lost)
// right here: that closes the assignment and updates IT Inventory at once. The IT part cannot be
// signed while any asset is still assigned.
export function AssetReturns({
  caseId,
  assets,
  canReturn,
}: {
  caseId: string;
  assets: OpenAsset[];
  canReturn: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (assets.length === 0) {
    return (
      <p className="text-sm text-green-700">
        No assets are assigned to this employee. Nothing to return.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {assets.map((a) => (
        <li key={a.assignment_id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900">
                {a.asset_tag} · {a.asset_name}
                {a.serial_number ? ` · S/N ${a.serial_number}` : ""}
              </p>
              <p className="text-xs text-slate-500">
                Assigned since {a.assignedOn}
                {a.assigned_condition ? ` (condition at handover: ${a.assigned_condition})` : ""}
              </p>
            </div>
            {canReturn &&
              (a.asset_status === "In Repair" ? (
                <span className="text-xs text-amber-700">
                  In repair: close the repair in IT Inventory first.
                </span>
              ) : (
                openId !== a.assignment_id && (
                  <button
                    type="button"
                    onClick={() => setOpenId(a.assignment_id)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Return
                  </button>
                )
              ))}
          </div>
          {canReturn && openId === a.assignment_id && (
            <ReturnForm
              caseId={caseId}
              assignmentId={a.assignment_id}
              onClose={() => setOpenId(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function ReturnForm({
  caseId,
  assignmentId,
  onClose,
}: {
  caseId: string;
  assignmentId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [condition, setCondition] = useState("");
  const [newStatus, setNewStatus] = useState<string>("Unassigned");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isLost = newStatus === "Lost";

  function handleSave() {
    setError(null);
    if (isLost && !remarks.trim()) {
      setError("Please write a remark for a lost asset.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await returnClearanceAsset(
          caseId,
          assignmentId,
          isLost ? "" : condition,
          newStatus,
          remarks,
        );
        if (result.error) {
          setError(result.error);
          return;
        }
        onClose();
        // Re-read the page: the asset leaves the list and Sign may unlock.
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          What happens to the asset
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            disabled={isPending}
            className={inputClass}
          >
            {NEW_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {!isLost && (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Condition on return
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              maxLength={300}
              placeholder="e.g. Good, screen scratched"
              disabled={isPending}
              className={inputClass}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700 sm:col-span-2">
          {isLost ? "Remarks (required: what happened?)" : "Remarks (optional)"}
          <input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            maxLength={300}
            disabled={isPending}
            className={inputClass}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || (isLost && !remarks.trim())}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : isLost ? "Mark lost" : "Record return"}
        </button>
      </div>
    </div>
  );
}
