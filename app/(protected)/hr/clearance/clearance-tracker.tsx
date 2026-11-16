import { createClient } from "@/lib/supabase/server";
import { cleanSlotLabel, formatTimestamp, orderSlotsHrLast } from "../resignations/clearance-view";

// The employee-facing clearance tracker, shared by the profile Offboarding card and
// /requests/offboarding/[id]. Reads only what RLS lets the employee see: the active slots and
// the signatures on their own case (never the answers or the expected signers).

export const MISSING_SETUP_WARNING =
  "Your site or department is not set in the portal. You can still submit, but HR cannot start your clearance until it is set. Please ask HR or the portal administrator to update your record.";

export type TrackerCase = {
  id: string;
  status: string;
  raised_via: "self" | "hrbp";
  employee_signed_at: string | null;
  created_at: string;
  forwarded_at: string | null;
  completed_at: string | null;
};

type Step = { key: string; label: string; done: boolean; detail: string };

async function loadSlotsAndSignoffs(caseId: string) {
  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const [slots, signoffs] = await Promise.all([
    hr
      .from("clearance_slots")
      .select("slot_key, label, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    hr
      .from("clearance_signoffs")
      .select("slot_key, signer_name, signer_designation, signed_at")
      .eq("case_id", caseId),
  ]);
  return {
    slots: slots.data ?? [],
    signoffs: signoffs.data ?? [],
    error: slots.error ?? signoffs.error,
  };
}

// "x of y" for the profile card: signatures on the currently active slots. Null on a read error.
export async function getSignatureCount(caseId: string) {
  const { slots, signoffs, error } = await loadSlotsAndSignoffs(caseId);
  if (error) return null;
  const active = new Set(slots.map((s) => s.slot_key));
  return {
    signed: signoffs.filter((s) => active.has(s.slot_key)).length,
    total: slots.length,
  };
}

export async function ClearanceTracker({ clearanceCase: c }: { clearanceCase: TrackerCase }) {
  const { slots, signoffs, error } = await loadSlotsAndSignoffs(c.id);
  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Could not load the signatures. Please try again later.
      </p>
    );
  }

  const signoffBySlot = new Map(signoffs.map((s) => [s.slot_key, s]));
  const submittedAt = c.employee_signed_at ?? c.created_at;
  const steps: Step[] = [
    {
      key: "submitted",
      label: "Submitted",
      done: true,
      detail:
        c.raised_via === "self"
          ? `Submitted on ${formatTimestamp(submittedAt)} (signed electronically)`
          : `Started by HR on ${formatTimestamp(c.created_at)}`,
    },
    {
      key: "forwarded",
      label: "Forwarded (In Clearance)",
      done: c.forwarded_at !== null,
      detail: c.forwarded_at ? `Forwarded on ${formatTimestamp(c.forwarded_at)}` : "Waiting",
    },
    // HR signs last (the database enforces it), so it is shown last, just before Completed.
    ...orderSlotsHrLast(slots).map((slot) => {
      const signoff = signoffBySlot.get(slot.slot_key);
      const signer = signoff
        ? signoff.signer_designation
          ? `${signoff.signer_name} (${signoff.signer_designation})`
          : signoff.signer_name
        : null;
      return {
        key: slot.slot_key,
        label: cleanSlotLabel(slot.label),
        done: Boolean(signoff),
        detail: signoff ? `Signed by ${signer} on ${formatTimestamp(signoff.signed_at)}` : "Waiting",
      };
    }),
    {
      key: "completed",
      label: "Completed",
      done: c.status === "Completed",
      detail: c.completed_at ? `Completed on ${formatTimestamp(c.completed_at)}` : "Waiting",
    },
  ];

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              step.done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
            }`}
            aria-hidden
          >
            {step.done ? "✓" : "○"}
          </span>
          <div>
            <p className="text-sm font-medium text-slate-900">{step.label}</p>
            <p className="text-xs text-slate-500">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
