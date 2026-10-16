import { inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";
import { returnAsset } from "../actions";
import { formatDate, RETURN_STATUSES } from "../asset-status";

// INV-04 Asset Return Form. Used on the asset detail page, and meant to be embedded on other IT
// pages (Javaria's offboarding "Asset Return Form" — pair it with listOpenAssignments() from
// lib/it/assets.ts, which gives assetId / assigned_date / assigned_condition per open row).
//
// Show it only for an asset that is In Use and a viewer with it.assets.assign — the Server Action
// and it.return_asset() both check again. `returnTo` works as in <AssetAssignForm>.
export function AssetReturnForm({
  assetId,
  assignedDate,
  assignedCondition,
  holderName,
  returnTo,
}: {
  assetId: string;
  assignedDate: string;
  assignedCondition?: string | null;
  holderName?: string | null;
  returnTo?: string;
}) {
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        {holderName ? (
          <>
            Held by <span className="font-medium text-slate-900">{holderName}</span> since{" "}
          </>
        ) : (
          "Assigned since "
        )}
        {formatDate(assignedDate)}
        {assignedCondition ? ` (condition at handover: ${assignedCondition})` : ""}.
      </p>
      <form action={returnAsset.bind(null, assetId)} className="space-y-3">
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
        <div>
          {/* Left empty = today, decided by the database (no server-timezone guess). */}
          <label className={labelClass}>Return date (leave empty for today)</label>
          <input type="date" name="return_date" min={assignedDate} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Condition on return</label>
          <input
            name="returned_condition"
            placeholder="e.g. Good, screen scratched"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Remarks</label>
          <input name="remarks" placeholder="Optional" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>After the return, the asset is</label>
          <select name="new_status" defaultValue="Unassigned" className={inputClass}>
            {RETURN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={primaryButtonClass}>
          Record return
        </button>
      </form>
    </>
  );
}
