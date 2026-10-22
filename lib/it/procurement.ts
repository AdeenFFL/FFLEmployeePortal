// Shared by the procurement screens (09-it-procurement-plan.md). No server-only imports.

import type { ItDemandCategory, ItDemandStatus } from "@/types/database";

type Tone = "positive" | "neutral" | "warning" | "negative" | "info";

export const DEMAND_STATUSES: ItDemandStatus[] = [
  "Open",
  "Categorized",
  "Pending Approval",
  "Approved",
  "Partially Approved",
  "Rejected",
  "Assigned to Vendor",
  "Partially Received",
  "Received",
  "Invoicing",
  "Stock Updated",
  "Closed",
  "Cancelled",
];

export const DEMAND_STATUS_TONE: Record<ItDemandStatus, Tone> = {
  Open: "info",
  Categorized: "info",
  "Pending Approval": "warning",
  Approved: "positive",
  "Partially Approved": "warning",
  Rejected: "negative",
  "Assigned to Vendor": "info",
  "Partially Received": "warning",
  Received: "positive",
  Invoicing: "info",
  "Stock Updated": "positive",
  Closed: "neutral",
  Cancelled: "neutral",
};

// Still being worked on — the default queue view.
export const ACTIVE_DEMAND_STATUSES: ItDemandStatus[] = DEMAND_STATUSES.filter(
  (s) => s !== "Closed" && s !== "Cancelled" && s !== "Rejected",
);

export const DEMAND_CATEGORIES: { value: ItDemandCategory; label: string; hint: string }[] = [
  { value: "Consumable", label: "Consumable", hint: "Issued from stock — no approval or vendor" },
  { value: "Open", label: "General purchase", hint: "New item to buy (BRD category \"Open\")" },
  { value: "Repair", label: "Repair", hint: "Parts or service to repair equipment" },
  { value: "Maintenance", label: "Maintenance", hint: "Planned maintenance purchase" },
  { value: "Fix", label: "Fix", hint: "One-off fix" },
];

export function demandCategoryLabel(value: ItDemandCategory | null) {
  if (!value) return "Not categorised";
  return DEMAND_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

// The main path a demand travels, for the step tracker on the demand page. The consumable path
// replaces the middle with "Stock Updated".
export const DEMAND_MAIN_PATH: ItDemandStatus[] = [
  "Open",
  "Categorized",
  "Pending Approval",
  "Approved",
  "Assigned to Vendor",
  "Received",
  "Invoicing",
  "Closed",
];
export const DEMAND_CONSUMABLE_PATH: ItDemandStatus[] = ["Open", "Categorized", "Stock Updated", "Closed"];

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

// Phase 4 documents (javaria_it_0012): private bucket, 5 MB per file (bucket limit), images or PDF.
export const DOCUMENT_BUCKET = "it-documents";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_UPLOAD = 3;
export const MAX_TOTAL_DOCUMENT_BYTES = 8 * 1024 * 1024; // under next.config's 9 MB body limit
export const DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const DOCUMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.pdf,image/*,application/pdf";
export const RECEIVING_CONDITIONS = ["Good", "Partially Damaged", "Damaged"] as const;

// Today in Pakistan time as YYYY-MM-DD (date inputs' default / max).
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

// Common units offered as suggestions; any text is accepted.
export const PRODUCT_UNITS = ["Each", "Box", "Pack", "Set", "Pair", "Roll", "Ream", "Meter", "Litre", "Kg", "License", "Month", "Year"];
