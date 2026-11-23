import { formatDay } from "../clearance-requests/clearance-view";

// The page-one details the HR signer fills in (form HR/002). One list of labels and units, used by
// the edit form, the read-only view and (later) the print page. Plain module — no "use client" —
// so server and client code can both import it.

export type HrDetailKey =
  | "contact_phone"
  | "contact_email"
  | "reporting_manager_name"
  | "postal_address"
  | "date_of_joining"
  | "last_working_date"
  | "resignation_letter_date"
  | "resignation_effective_from"
  | "unserved_notice_days"
  | "overtime_single"
  | "overtime_double"
  | "overtime_triple"
  | "annual_leave_balance"
  | "other_outstanding"
  | "handing_over_to"
  | "email_forward_to";

// What the form holds: every value as text ("" = empty).
export type HrDetailsValues = Record<HrDetailKey, string>;

type FieldKind = "text" | "email" | "textarea" | "date" | "whole" | "decimal";

export type HrDetailField = {
  key: HrDetailKey;
  label: string;
  kind: FieldKind;
  unit?: "days" | "hours";
  maxLength?: number;
  step?: string;
  required?: boolean;
  // Set by the Line manager picker, not typed here: shown read-only, and the save keeps the
  // value already on the case.
  fromPicker?: boolean;
};

export const HR_DETAIL_GROUPS: { title: string; fields: HrDetailField[] }[] = [
  {
    title: "Contact",
    fields: [
      { key: "contact_phone", label: "Mobile number", kind: "text", maxLength: 100 },
      { key: "contact_email", label: "Personal email", kind: "email", maxLength: 200 },
      {
        key: "reporting_manager_name",
        label: "Direct reporting manager",
        kind: "text",
        maxLength: 200,
        fromPicker: true,
      },
      { key: "postal_address", label: "Postal address", kind: "textarea", maxLength: 500 },
    ],
  },
  {
    title: "Dates",
    fields: [
      { key: "date_of_joining", label: "Date of joining", kind: "date" },
      { key: "last_working_date", label: "Last working date", kind: "date", required: true },
    ],
  },
  {
    title: "Resignation",
    fields: [
      { key: "resignation_letter_date", label: "Resignation letter submitted on", kind: "date" },
      { key: "resignation_effective_from", label: "Effective from", kind: "date" },
      { key: "unserved_notice_days", label: "Un-served notice period", kind: "whole", unit: "days" },
    ],
  },
  {
    title: "Salary & leaves",
    fields: [
      { key: "overtime_single", label: "Overtime: single", kind: "decimal", unit: "hours", step: "0.25" },
      { key: "overtime_double", label: "Overtime: double", kind: "decimal", unit: "hours", step: "0.25" },
      { key: "overtime_triple", label: "Overtime: triple", kind: "decimal", unit: "hours", step: "0.25" },
      {
        key: "annual_leave_balance",
        label: "Un-availed annual leave balance",
        kind: "decimal",
        unit: "days",
        step: "0.5",
      },
      {
        key: "other_outstanding",
        label: "Any other outstanding amount",
        kind: "text",
        maxLength: 500,
      },
    ],
  },
  {
    // Who holds the leaving employee's charge and mail now (printed on page one of the form).
    title: "Charge handover",
    fields: [
      { key: "handing_over_to", label: "Handing over done to (Mr. / Ms.)", kind: "text", maxLength: 200 },
      { key: "email_forward_to", label: "Email forwarding to", kind: "text", maxLength: 200 },
    ],
  },
];

export const HR_DETAIL_FIELDS = HR_DETAIL_GROUPS.flatMap((g) => g.fields);

// numeric(7,2) in the database.
export const MAX_DECIMAL = 99999.99;

type CaseDetails = {
  contact_phone: string | null;
  contact_email: string | null;
  reporting_manager_name: string | null;
  postal_address: string | null;
  date_of_joining: string | null;
  last_working_date: string;
};
type SavedDetails = {
  resignation_letter_date: string | null;
  resignation_effective_from: string | null;
  unserved_notice_days: number | null;
  overtime_single: number | null;
  overtime_double: number | null;
  overtime_triple: number | null;
  annual_leave_balance: number | null;
  other_outstanding: string | null;
  handing_over_to: string | null;
  email_forward_to: string | null;
};

// The values to show: the contact fields come from the case, the rest from hr.clearance_hr_details
// (no row yet = empty).
export function toHrDetailsValues(c: CaseDetails, saved: SavedDetails | null): HrDetailsValues {
  const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    contact_phone: text(c.contact_phone),
    contact_email: text(c.contact_email),
    reporting_manager_name: text(c.reporting_manager_name),
    postal_address: text(c.postal_address),
    date_of_joining: text(c.date_of_joining),
    last_working_date: text(c.last_working_date),
    resignation_letter_date: text(saved?.resignation_letter_date),
    resignation_effective_from: text(saved?.resignation_effective_from),
    unserved_notice_days: text(saved?.unserved_notice_days),
    overtime_single: text(saved?.overtime_single),
    overtime_double: text(saved?.overtime_double),
    overtime_triple: text(saved?.overtime_triple),
    annual_leave_balance: text(saved?.annual_leave_balance),
    other_outstanding: text(saved?.other_outstanding),
    handing_over_to: text(saved?.handing_over_to),
    email_forward_to: text(saved?.email_forward_to),
  };
}

// A value for display, or null when empty. Numbers lose trailing zeros (2.50 -> "2.5").
export function formatHrDetail(field: HrDetailField, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field.kind === "date") return formatDay(v);
  if (field.kind === "whole" || field.kind === "decimal") {
    const n = String(Number(v));
    if (field.unit === "hours") return `${n} hrs`;
    if (field.unit === "days") return `${n} day${n === "1" ? "" : "s"}`;
    return n;
  }
  return v;
}
