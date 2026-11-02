"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

// Procurement settings (09-it-procurement-plan.md addition P4). Single row in
// it.procurement_settings; ranges match the table's check constraints.

const PATH = "/it/procurement/settings";

function go(kind: "error" | "notice", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function wholeNumber(formData: FormData, key: string, min: number, max: number, label: string) {
  const n = Number(String(formData.get(key) ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > max) go("error", `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

export async function updateProcurementSettings(formData: FormData) {
  const { supabase } = await requirePermission("it.procurement_settings.update");

  const finance = wholeNumber(formData, "financeSlaDays", 1, 90, "Finance SLA");
  const reminder = wholeNumber(formData, "reminderIntervalDays", 1, 30, "Reminder interval");
  const tolerance = Number(String(formData.get("invoiceTolerancePct") ?? "").trim());
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 20) {
    go("error", "Invoice tolerance must be between 0 and 20 %.");
  }

  const { error } = await supabase
    .schema("it")
    .from("procurement_settings")
    .update({
      finance_sla_days: finance,
      reminder_interval_days: reminder,
      invoice_tolerance_pct: Math.round(tolerance * 100) / 100,
      consumable_path_enabled: formData.get("consumablePathEnabled") === "on",
    })
    .eq("id", true);
  if (error) go("error", error.message);

  revalidatePath(PATH);
  go("notice", "Procurement settings saved.");
}
