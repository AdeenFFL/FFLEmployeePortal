import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// The signer inbox's lookup (/hr/clearance). No database function is needed: RLS already lets a
// signer read their OWN hr.clearance_signers rows, the cases where they are a signer
// (hr.is_any_clearance_signer) and the signatures on them. "Which slots do I hold for this case"
// is the same rule as hr.is_clearance_signer, worked out here in code.

type Client = SupabaseClient<Database>;
type FormKey = Database["hr"]["Tables"]["clearance_lines"]["Row"]["form_key"];

export type SlotRow = {
  slot_key: string;
  form_key: FormKey;
  label: string;
  scope: "site" | "department";
  sort_order: number;
};
type MySignerRow = { slot_key: string; site_id: string | null; department_id: string | null };
type CaseScope = { site_id: string | null; department_id: string | null };

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The words on the paper forms for Yes / No / N/A. "No" is always the negative answer.
export const ANSWER_LABELS: Record<FormKey, { Yes: string; No: string; "N/A": string }> = {
  page_one: { Yes: "Ticked", No: "Not ticked", "N/A": "N/A" },
  admin: { Yes: "Collected", No: "Not collected", "N/A": "N/A" },
  accounts: { Yes: "Cleared", No: "Not cleared", "N/A": "N/A" },
  it: { Yes: "Yes", No: "No", "N/A": "N/A" },
};

export const FORM_TITLES: Record<FormKey, string> = {
  page_one: "Page one (HR checklist)",
  admin: "Administration / Sales Operation / Area Office",
  accounts: "Accounts",
  it: "Information Technology",
};

// My signer rows and the active slots, in sort order.
export async function loadSignerSetup(supabase: Client, personId: string) {
  const hr = supabase.schema("hr");
  const [signers, slots] = await Promise.all([
    hr.from("clearance_signers").select("slot_key, site_id, department_id").eq("person_id", personId),
    hr
      .from("clearance_slots")
      .select("slot_key, form_key, label, scope, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  return {
    signers: (signers.data ?? []) as MySignerRow[],
    slots: (slots.data ?? []) as SlotRow[],
    error: signers.error ?? slots.error,
  };
}

// The active slots I sign for on this case: site slots by the case's site, the department slot
// by its department (same rule as hr.is_clearance_signer).
export function mySlotsForCase(c: CaseScope, signers: MySignerRow[], slots: SlotRow[]) {
  return slots.filter((s) =>
    signers.some(
      (g) =>
        g.slot_key === s.slot_key &&
        (s.scope === "site"
          ? g.site_id !== null && g.site_id === c.site_id
          : g.department_id !== null && g.department_id === c.department_id),
    ),
  );
}

// The sites and departments my signer rows cover — narrows the case query, since read_all
// holders can read every case.
export function myScopes(signers: MySignerRow[], slots: SlotRow[]) {
  const active = new Set(slots.map((s) => s.slot_key));
  const mine = signers.filter((g) => active.has(g.slot_key));
  return {
    siteIds: [...new Set(mine.flatMap((g) => (g.site_id ? [g.site_id] : [])))],
    departmentIds: [...new Set(mine.flatMap((g) => (g.department_id ? [g.department_id] : [])))],
  };
}
