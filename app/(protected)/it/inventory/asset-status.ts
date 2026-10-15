import type { Asset } from "@/types/database";

export type AssetStatus = Asset["status"];

// Vocabulary from 07-it-inventory-plan.md §1.3 #6, matching the check constraint in 0028.
export const ASSET_STATUSES: AssetStatus[] = [
  "Unassigned",
  "In Use",
  "In Repair",
  "Retired",
  "Disposed",
  "Lost",
];

// Set only by the assignment (Phase 3) and maintenance (Phase 4) flows, never by hand.
export const SYSTEM_MANAGED_STATUSES: AssetStatus[] = ["In Use", "In Repair"];

// What the "Change status" control on the asset detail page may set.
export const MANUAL_STATUSES: AssetStatus[] = ["Unassigned", "Retired", "Disposed", "Lost"];

// What a return may set the asset to. it.return_asset() also accepts "In Repair", but that would
// leave the asset In Repair with no repair record to close it — repairs get their own form in
// Phase 4.
export const RETURN_STATUSES = ["Unassigned", "Retired"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const ASSET_STATUS_TONES: Record<
  AssetStatus,
  "positive" | "neutral" | "warning" | "negative" | "info"
> = {
  Unassigned: "info",
  "In Use": "positive",
  "In Repair": "warning",
  Retired: "neutral",
  Disposed: "neutral",
  Lost: "negative",
};

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
