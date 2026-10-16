import { inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";
import { assignAsset } from "../actions";
import { PersonPicker } from "./person-picker";

// INV-04 Asset Assignment Form. Used on the asset detail page, and meant to be embedded on other
// IT pages (Javaria's onboarding "Asset Allocation" task, 07-it-inventory-plan.md §2.1).
//
// Show it only for an Unassigned asset and a viewer with it.assets.assign — the Server Action and
// it.assign_asset() both check again. `returnTo` is the page to come back to afterwards (a path
// under /it/; anything else falls back to the asset detail page), with ?notice= or ?error= added.
export function AssetAssignForm({
  assetId,
  defaultCondition,
  returnTo,
}: {
  assetId: string;
  defaultCondition?: string | null;
  returnTo?: string;
}) {
  return (
    <form action={assignAsset.bind(null, assetId)} className="space-y-3">
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <div>
        <label className={labelClass}>Employee *</label>
        <PersonPicker name="person_id" />
      </div>
      <div>
        {/* Left empty = today, decided by the database (no server-timezone guess). */}
        <label className={labelClass}>Assigned date (leave empty for today)</label>
        <input type="date" name="assigned_date" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Condition at handover</label>
        <input
          name="condition"
          defaultValue={defaultCondition ?? ""}
          placeholder="e.g. New, Good"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Remarks</label>
        <input name="remarks" placeholder="Optional" className={inputClass} />
      </div>
      <button type="submit" className={primaryButtonClass}>
        Assign asset
      </button>
    </form>
  );
}
