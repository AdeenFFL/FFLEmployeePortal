"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnClearanceAsset } from "./actions";
import { LineAssign, type LineAssignee } from "./line-assign";
import { RemarksButton } from "./remarks-button";
import { PopupCard } from "./popup-card";
import { CheckIcon, XIcon } from "@/components/icons";

export type OpenAsset = {
  assignment_id: string;
  asset_tag: string;
  asset_name: string;
  serial_number: string | null;
  // Already formatted on the server.
  assignedOn: string;
  assigned_condition: string | null;
  asset_status: string;
  // talha_hr_0012: whom the lead handed this return to; undefined = handing out not available.
  assignee?: LineAssignee | null;
};

// Same choices as hr.clearance_return_asset accepts.
const NEW_STATUSES = [
  { value: "Unassigned", label: "Returned: back in stock (Unassigned)" },
  { value: "Retired", label: "Returned: retire it (Retired)" },
  { value: "Lost", label: "Not returned: mark it Lost" },
] as const;

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// The return form's two buttons: Cancel outlined, Record return filled.
const cancelButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const saveReturnButton =
  "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

// A small ⓘ button beside an asset: click to show its details in a little panel.
function AssetInfo({ asset }: { asset: OpenAsset }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  // Close on a click (or tap) anywhere outside the button and its panel.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const rows: [string, string][] = [
    ["S/N", asset.serial_number ?? "—"],
    ["Assigned since", asset.assignedOn],
    ["Condition at handover", asset.assigned_condition ?? "—"],
  ];
  return (
    <span ref={boxRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Details of ${asset.asset_tag}`}
        title="Asset details"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <dl className="flex flex-col gap-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right font-medium text-slate-800">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </span>
  );
}

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
  // Stable, so the popup's Esc listener is not re-added on every render.
  const closeForm = useCallback(() => setOpenId(null), []);

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
        <li
          key={a.assignment_id}
          className="-mx-2 flex flex-col gap-2 rounded-lg px-2 py-2.5 hover:bg-slate-50"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Tag and name; the ⓘ button shows the rest (S/N, since when, condition). */}
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-sm font-medium text-slate-900">
                {a.asset_tag} · {a.asset_name}
              </p>
              <AssetInfo asset={a} />
            </div>
            {/* Return and Assign side by side, as buttons (Assign opens its popup). */}
            <div className="flex flex-wrap items-center gap-2">
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
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    >
                      {/* Return arrow (no shared icon for it). */}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      >
                        <path d="M9 14 4 9l5-5" />
                        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                      </svg>
                      Return
                    </button>
                  )
                ))}
              {canReturn &&
                a.assignee !== undefined &&
                a.asset_status !== "In Repair" && (
                  <LineAssign
                    caseId={caseId}
                    target={{ kind: "asset", assignmentId: a.assignment_id }}
                    assignee={a.assignee}
                    disabled={false}
                    label={`Return ${a.asset_tag} · ${a.asset_name}`}
                    compact
                  />
                )}
            </div>
          </div>
          {canReturn && openId === a.assignment_id && (
            // Its own card (a popup) that eases in.
            <PopupCard
              title="Return asset"
              subtitle={`${a.asset_tag} · ${a.asset_name}`}
              onClose={closeForm}
            >
              <ReturnForm
                caseId={caseId}
                assignmentId={a.assignment_id}
                onClose={closeForm}
              />
            </PopupCard>
          )}
        </li>
      ))}
    </ul>
  );
}

// Also used on My clearance tasks, by the IT staff member an asset return was handed to.
export function ReturnForm({
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
    // Two labelled fields side by side (stacked on a phone), then Remarks on the left and
    // Cancel / Save on the right.
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700">What happens to it</span>
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
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700">
              Condition on return
            </span>
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              maxLength={300}
              placeholder="e.g. Good"
              disabled={isPending}
              className={inputClass}
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <RemarksButton
          value={remarks}
          onChange={setRemarks}
          label="Return remarks"
          required={isLost}
          disabled={isPending}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={cancelButton}
          >
            <XIcon className="h-4 w-4" />
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || (isLost && !remarks.trim())}
            className={saveReturnButton}
          >
            <CheckIcon className="h-4 w-4" />
            {isPending ? "Saving…" : isLost ? "Mark lost" : "Record return"}
          </button>
        </div>
      </div>
      {isLost && !remarks.trim() && (
        <p className="text-sm text-slate-500">
          A lost asset needs a remark (💬): what happened?
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
