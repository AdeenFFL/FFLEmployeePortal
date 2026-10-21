// Shared by the procurement screens (09-it-procurement-plan.md). No server-only imports.

// Amounts are stored as numeric(12,2) in PKR; shown with thousands separators, 2 decimals.
export function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `Rs ${n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Parse a money input; "" → null, invalid / negative → undefined (caller reports the error).
export function parseMoney(raw: FormDataEntryValue | null): number | null | undefined {
  const text = String(raw ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99) return undefined;
  return Math.round(n * 100) / 100;
}

// Common units offered as suggestions; any text is accepted.
export const PRODUCT_UNITS = ["Each", "Box", "Pack", "Set", "Pair", "Roll", "Ream", "Meter", "Litre", "Kg", "License", "Month", "Year"];
