"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { queueItEmails } from "@/lib/it/notifications";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItEmployeeCategory, ItTicketPriority } from "@/types/database";

// Self-service counterpart to app/(protected)/it/onboarding/actions.ts's createLifecycleRequest
// (HR-only). Modeled on my-tickets/actions.ts's createItTicket: single permission check up
// front, defaults pulled from the caller's own persons row, no employee picker since it's always
// the current person. The RLS insert policy (0043_it_self_offboarding.sql) is what actually
// restricts this to the caller's own person_id — this check is defense in depth, same relation
// as everywhere else in this module.
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

export async function createSelfOffboardingRequest(formData: FormData) {
  const NEW = "/it/my-offboarding/new";
  const { supabase, personId } = await requirePermission("module:it");

  const lastWorkingDate = text(formData, "lastWorkingDate");
  const category = text(formData, "employeeCategory") as ItEmployeeCategory;
  const priority = (text(formData, "priority") || "Medium") as ItTicketPriority;
  if (!lastWorkingDate) fail(NEW, "Enter your last working date.");
  if (!["Permanent", "Contractual"].includes(category)) fail(NEW, "Choose Permanent or Contractual.");
  if (!TICKET_PRIORITIES.includes(priority)) fail(NEW, "Invalid priority.");

  const { data: requestType } = await supabase
    .schema("it")
    .from("request_types")
    .select("id")
    .eq("applies_to", "Offboarding")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!requestType) fail(NEW, "No active offboarding request type is configured.");

  const { data: person } = await supabase
    .from("persons")
    .select("full_name, employee_code, designation, site_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person) fail(NEW, "Could not find your employee record.");

  const { data: created, error } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .insert({
      request_type_id: requestType.id,
      person_id: personId,
      employee_name: person.full_name,
      employee_code: person.employee_code,
      designation: person.designation,
      employee_category: category,
      site_id: person.site_id,
      last_working_date: lastWorkingDate,
      email_required: true,
      known_assets_accesses: optional(formData, "knownAssetsAccesses"),
      priority,
      remarks: optional(formData, "remarks"),
    })
    .select("id, request_number")
    .single();
  if (error || !created) fail(NEW, error?.message ?? "Could not submit the request.");

  queueItEmails();
  revalidatePath("/it/my-offboarding");
  revalidatePath("/it/onboarding");

  redirect(
    `/it/my-offboarding?notice=${encodeURIComponent(
      `${created.request_number} submitted. IT and HR have been notified.`,
    )}`,
  );
}
