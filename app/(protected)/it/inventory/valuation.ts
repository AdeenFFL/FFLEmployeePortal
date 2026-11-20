import type { AssetValueType } from "@/types/database";

// Phase 6 valuation (07 §5): book value worked out from the latest it.asset_values row and the
// New / Old rules in it.asset_value_types. Depreciation runs from the row's valuation_date
// (the delivery date for received assets) and never goes below the salvage value.
//   Straight Line:    the same amount every year — (purchase − salvage) × rate, or ÷ useful life.
//   Reducing Balance: the rate comes off what is left each year.

export type ValuationRecord = {
  purchase_value: number;
  salvage_value: number;
  valuation_date: string;
};

export type BookValue = {
  purchase: number;
  current: number;
  depreciated: number;
  // 0–1 share of the depreciable amount already used up (for the progress bar).
  used: number;
  yearsElapsed: number;
  fullyDepreciated: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

export function bookValue(
  record: ValuationRecord,
  rule: Pick<AssetValueType, "depreciation_percentage" | "depreciation_method" | "useful_life_years">,
  asOf: Date,
): BookValue {
  const purchase = Number(record.purchase_value);
  const salvage = Math.min(Number(record.salvage_value), purchase);
  const years = Math.max(0, (asOf.getTime() - new Date(record.valuation_date).getTime()) / DAY / 365.25);
  const rate = Number(rule.depreciation_percentage) / 100;
  const life = rule.useful_life_years;

  let current: number;
  if (rule.depreciation_method === "Reducing Balance") {
    current = rate > 0 ? purchase * Math.pow(1 - Math.min(rate, 1), years) : purchase;
    if (life && years >= life) current = salvage;
  } else {
    const perYear = rate > 0 ? (purchase - salvage) * rate : life ? (purchase - salvage) / life : 0;
    current = purchase - perYear * years;
  }
  current = Math.max(salvage, Math.round(current * 100) / 100);

  const depreciable = purchase - salvage;
  const depreciated = Math.round((purchase - current) * 100) / 100;
  return {
    purchase,
    current,
    depreciated,
    used: depreciable > 0 ? Math.min(1, depreciated / depreciable) : 0,
    yearsElapsed: years,
    fullyDepreciated: depreciable > 0 && current <= salvage,
  };
}

export function formatPkr(value: number) {
  return `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}
