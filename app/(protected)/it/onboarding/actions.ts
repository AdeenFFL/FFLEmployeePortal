"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireActiveUser } from "@/lib/auth/require-user";
import { queueItEmails } from "@/lib/it/notifications";
import { CHECKLIST_STATUSES, LIFECYCLE_KINDS, TASK_DETAIL_FIELDS } from "@/lib/it/onboarding";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type {
  ItChecklistStatus,
  ItEmployeeCategory,
  ItLifecycleKind,
  ItTicketPriority,
} from "@/types/database";

// Same shape as the ticket actions: permission checked here (defense in depth), then RLS and the
// triggers in javaria_it_0002_onboarding_offboarding.sql enforce who may change what and which
// status moves are allowed. Messages come back as ?error= / ?notice=.

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function refresh(requestId?: string) {
  queueItEmails(); // notification rows were written by DB triggers; deliver their emails
  revalidatePath("/it/onboarding");
  revalidatePath("/it/my-onboarding");
  if (requestId) revalidatePath(`/it/onboarding/${requestId}`);
}

// BRD §5.1.1 / §5.2.1 — HR raises the request; the default checklist is created by trigger.
export async function createLifecycleRequest(formData: FormData) {
  const kind = text(formData, "kind") as ItLifecycleKind;
  const back = `/it/onboarding/new?kind=${encodeURIComponent(kind)}`;
  if (!LIFECYCLE_KINDS.includes(kind)) go("/it/onboarding/new", "error", "Choose a request type.");

  const { supabase } = await requirePermission("it.onboarding.create");

  const priority = (text(formData, "priority") || "Medium") as ItTicketPriority;
  if (!TICKET_PRIORITIES.includes(priority)) go(back, "error", "Invalid priority.");

  const { data: requestType } = await supabase
    .schema("it")
    .from("request_types")
    .select("id")
    .eq("applies_to", kind)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!requestType) go(back, "error", `No active ${kind} request type is configured.`);

  const personId = optional(formData, "personId");
  const employeeName = text(formData, "employeeName");
  const category = optional(formData, "employeeCategory") as ItEmployeeCategory | null;

  if (kind === "Onboarding") {
    if (!employeeName) go(back, "error", "Enter the new joiner's name.");
    if (!text(formData, "joiningDate")) go(back, "error", "Enter the joining date.");
  } else {
    if (!personId) go(back, "error", "Select the employee.");
    if (kind === "Offboarding") {
      if (!text(formData, "lastWorkingDate")) go(back, "error", "Enter the last working date.");
      if (!category) go(back, "error", "Choose Permanent or Contractual.");
    }
  }

  const { data: created, error } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .insert({
      request_type_id: requestType.id,
      person_id: kind === "Onboarding" ? null : personId,
      // Overwritten from persons by trigger when person_id is set.
      employee_name: employeeName || "—",
      employee_code: optional(formData, "employeeCode"),
      designation: optional(formData, "designation"),
      grade: optional(formData, "grade"),
      employee_category: category,
      site_id: optional(formData, "siteId"),
      department_id: optional(formData, "departmentId"),
      reporting_manager_name: optional(formData, "reportingManager"),
      personal_email: optional(formData, "personalEmail"),
      joining_date: optional(formData, "joiningDate"),
      last_working_date: optional(formData, "lastWorkingDate"),
      laptop_required: formData.get("laptopRequired") === "on",
      email_required: kind === "Onboarding" ? formData.get("emailRequired") === "on" : true,
      access_required: optional(formData, "accessRequired"),
      software_required: optional(formData, "softwareRequired"),
      known_assets_accesses: optional(formData, "knownAssetsAccesses"),
      priority,
      remarks: optional(formData, "remarks"),
    })
    .select("id, request_number")
    .single();
  if (error || !created) go(back, "error", error?.message ?? "Could not create the request.");

  refresh();
  go(`/it/onboarding/${created.id}`, "notice", `${created.request_number} raised. IT has been notified.`);
}

// BRD §5.1.4 / §5.2.5 — the IT Executive picks the request up.
export async function takeOwnership(requestId: string) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase, personId } = await requirePermission("it.onboarding.assign");

  const { data: current } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();
  if (!current) go(path, "error", "Request not found.");

  const { error } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .update({
      it_executive_person_id: personId,
      ...(current.status === "Open" ? { status: "Under Review" as const } : {}),
    })
    .eq("id", requestId);
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "You are now the IT Executive on this request.");
}

// BRD §5.1.5 / §5.2.6 — assign a checklist item to an IT team member.
export async function assignChecklistItem(requestId: string, itemId: string, formData: FormData) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission("it.onboarding.assign");

  const { error } = await supabase
    .schema("it")
    .from("checklist_items")
    .update({ assigned_to_person_id: optional(formData, "assigneeId") })
    .eq("id", itemId)
    .eq("request_id", requestId);
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "Task assignment saved.");
}

// The assignee records what was done (BRD §5.1.6–5.1.11, §5.2.7–5.2.10) and the item's status.
export async function updateChecklistItem(requestId: string, itemId: string, formData: FormData) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission("it.onboarding.read");

  const status = text(formData, "status") as ItChecklistStatus;
  if (!CHECKLIST_STATUSES.includes(status)) go(path, "error", "Invalid task status.");

  const { data: item } = await supabase
    .schema("it")
    .from("checklist_items")
    .select("task_type, details")
    .eq("id", itemId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (!item) go(path, "error", "Task not found.");

  const details: Record<string, string> = { ...(item.details ?? {}) };
  for (const field of TASK_DETAIL_FIELDS[item.task_type]) {
    const value = text(formData, `detail_${field.key}`);
    if (value) details[field.key] = value;
    else delete details[field.key];
  }

  const { data, error } = await supabase
    .schema("it")
    .from("checklist_items")
    .update({ status, details, notes: optional(formData, "notes") })
    .eq("id", itemId)
    .eq("request_id", requestId)
    .select("id");
  if (error) go(path, "error", error.message);
  if (!data?.length) go(path, "error", "You can only update tasks assigned to you.");

  refresh(requestId);
  go(path, "notice", `Task saved as ${status}.`);
}

export async function addChecklistItem(requestId: string, formData: FormData) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission("it.onboarding.assign");

  const taskName = text(formData, "taskName");
  if (!taskName) go(path, "error", "Task name is required.");

  const { error } = await supabase
    .schema("it")
    .from("checklist_items")
    .insert({
      request_id: requestId,
      task_type: "other",
      task_name: taskName,
      sort_order: 100,
      assigned_to_person_id: optional(formData, "assigneeId"),
    });
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "Task added.");
}

// BRD §5.1.11 — link the new joiner's portal account (created on /admin/users) to the request.
export async function linkOnboardingPerson(requestId: string, formData: FormData) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requireActiveUser();

  const personId = text(formData, "personId");
  if (!personId) go(path, "error", "Select the employee's portal account.");

  const { error } = await supabase
    .schema("it")
    .rpc("link_onboarding_person", { p_request_id: requestId, p_person_id: personId });
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "Employee linked. They can now see and confirm their onboarding.");
}

export async function cancelRequest(requestId: string, formData: FormData) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission("it.onboarding.assign");

  const reason = text(formData, "reason");
  if (!reason) go(path, "error", "Please give a reason for cancelling.");

  const { error } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .update({ status: "Cancelled", cancelled_reason: reason })
    .eq("id", requestId);
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "Request cancelled.");
}

// BRD §5.1.15 / §5.2.16 — formal closure. Offboarding needs HOD IT; others the IT Executive.
export async function closeRequest(requestId: string) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requireActiveUser();

  const { data: current } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select("kind")
    .eq("id", requestId)
    .maybeSingle();
  if (!current) go(path, "error", "Request not found.");
  await requirePermission(
    current.kind === "Offboarding" ? "it.onboarding.approve" : "it.onboarding.assign",
  );

  const { error } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .update({ status: "Closed" })
    .eq("id", requestId);
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(path, "notice", "Request closed. The full history is kept for audits.");
}

// BRD §5.2.13–5.2.14 — handover-takeover sign-off.
export async function signOffboarding(requestId: string, role: "executive" | "hod") {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission(
    role === "hod" ? "it.onboarding.approve" : "it.onboarding.assign",
  );

  const { error } = await supabase
    .schema("it")
    .rpc("sign_offboarding", { p_request_id: requestId, p_role: role });
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(
    path,
    "notice",
    role === "hod" ? "Approved by HOD IT. Offboarding completed." : "Signed by IT Executive.",
  );
}

export async function addLifecycleUpdate(requestId: string, formData: FormData) {
  const back = text(formData, "returnTo") === "my" ? "/it/my-onboarding" : `/it/onboarding/${requestId}`;
  const { supabase, personId } = await requireActiveUser();

  const body = text(formData, "body");
  if (!body) go(back, "error", "Message cannot be empty.");
  const internal = formData.get("visibility") === "internal";

  const { error } = await supabase
    .schema("it")
    .from("onboarding_updates")
    .insert({
      request_id: requestId,
      author_person_id: personId,
      update_type: internal ? "work_note" : "comment",
      body,
      is_internal: internal,
    });
  if (error) go(back, "error", error.message);

  refresh(requestId);
  go(back, "notice", internal ? "Internal note added." : "Comment added.");
}

// BRD §5.1.13 — the new joiner confirms what they received.
export async function confirmOnboarding(requestId: string, formData: FormData) {
  const path = "/it/my-onboarding";
  const { supabase } = await requireActiveUser();

  const { data, error } = await supabase.schema("it").rpc("confirm_onboarding", {
    p_request_id: requestId,
    p_email_ok: formData.get("emailOk") === "on",
    p_access_ok: formData.get("accessOk") === "on",
    p_software_ok: formData.get("softwareOk") === "on",
    p_asset_ok: formData.get("assetOk") === "on",
    p_notes: optional(formData, "notes"),
  });
  if (error) go(path, "error", error.message);

  refresh(requestId);
  go(
    path,
    "notice",
    data === "Completed"
      ? "Thanks — your onboarding is complete. Welcome aboard!"
      : "Thanks — IT has been told what's missing and will follow up.",
  );
}
