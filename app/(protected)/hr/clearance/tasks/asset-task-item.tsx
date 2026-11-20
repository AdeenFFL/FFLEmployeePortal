"use client";

import { useState } from "react";
import { ReturnForm } from "../[caseId]/[slotKey]/asset-returns";

// One asset the IT Team Lead asked me to collect: Return opens the same form the lead uses
// (condition, Unassigned / Retired / Lost, remarks); saving updates IT Inventory.
export function AssetTaskItem({
  caseId,
  assignmentId,
  title,
  detail,
  inRepair,
}: {
  caseId: string;
  assignmentId: string;
  title: string;
  detail: string;
  inRepair: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-slate-900">{title}</p>
          <p className="text-xs text-slate-500">{detail}</p>
        </div>
        {inRepair ? (
          <span className="text-xs text-amber-700">In repair: close the repair in IT Inventory first.</span>
        ) : (
          !open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Return
            </button>
          )
        )}
      </div>
      {open && <ReturnForm caseId={caseId} assignmentId={assignmentId} onClose={() => setOpen(false)} />}
    </li>
  );
}
