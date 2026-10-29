"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireActiveUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/log";
import { queueItEmails } from "@/lib/it/notifications";
import {
  CHECKLIST_STATUSES,
  LIFECYCLE_KINDS,
  suggestEmailAccount,
  TASK_DETAIL_FIELDS,
} from "@/lib/it/onboarding";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type {
  EmployeeLookup,
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
  revalidatePath("/it/my-offboarding");
  if (requestId) revalidatePath(`/it/onboarding/${requestId}`);
}

// Type-ahead for the employee picker (javaria_it_0018). it.employee_lookup() does the access
// check (HR / onboarding staff) and returns nothing to anyone else. A database error (e.g. the
// migration not applied yet) comes back as `error` so the picker can say so instead of
// pretending nobody matched.
export async function findEmployees(
  query: string,
): Promise<{ rows: EmployeeLookup[]; error: string | null }> {
  const q = query.trim();
  if (q.length < 2) return { rows: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.schema("it").rpc("employee_lookup", { p_search: q.slice(0, 80) });
  if (error) {
    console.error("employee_lookup failed", error.message);
    return { rows: [], error: "Employee search isn't available right now. Ask IT to apply javaria_it_0018." };
  }
  return { rows: data ?? [], error: null };
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

  // Pre-fill the auto-created "Email Account" task with a suggested address so IT starts from
  // a concrete proposal instead of a blank field (see suggestEmailAccount's own comment for why
  // this is a suggestion, not a real mailbox creation).
  if (kind === "Onboarding" && formData.get("emailRequired") === "on") {
    const { email_address, username } = suggestEmailAccount(employeeName);
    if (email_address) {
      await createAdminClient()
        .schema("it")
        .from("checklist_items")
        .update({ details: { email_address, username } })
        .eq("request_id", created.id)
        .eq("task_type", "email_account");
    }
  }

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

// Powers the asset-search combobox on the Asset Allocation task form. Data-returning, not a
// form action; gated the same as it.assign_asset() itself since that's what a selection feeds.
export async function searchUnassignedAssets(query: string) {
  const { supabase } = await requirePermission("it.assets.assign");
  if (!query.trim()) return [];
  const { data } = await supabase
    .schema("it")
    .rpc("search_unassigned_assets", { p_search: query });
  return data ?? [];
}

// Wires the "Asset Allocation" checklist task to the real asset register (IT module revision,
// Phase 3) instead of a free-text asset_tag note. Requires it.assets.assign — the same
// permission it.assign_asset() itself hard-checks — so this can only ever succeed for someone
// who could also assign the asset directly from the Asset Register; the checklist_items update
// that follows still goes through its own RLS (it.onboarding.assign / it.onboarding.update),
// same as updateChecklistItem above. In practice every role holding it.onboarding.assign today
// also holds it.assets.assign (IT Admin, IT Executive (HQ)).
export async function assignAssetForOnboardingTask(
  requestId: string,
  itemId: string,
  formData: FormData,
) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase } = await requirePermission("it.assets.assign");

  const assetId = text(formData, "asset_id");
  if (!assetId) go(path, "error", "Choose an asset to assign.");

  const [{ data: item }, { data: request }] = await Promise.all([
    supabase
      .schema("it")
      .from("checklist_items")
      .select("task_type")
      .eq("id", itemId)
      .eq("request_id", requestId)
      .maybeSingle(),
    supabase
      .schema("it")
      .from("onboarding_offboarding")
      .select("person_id")
      .eq("id", requestId)
      .maybeSingle(),
  ]);
  if (!item || item.task_type !== "asset_allocation") go(path, "error", "Task not found.");
  if (!request?.person_id) {
    go(path, "error", "This request isn't linked to a portal account yet — link it first.");
  }

  const { data: assignmentId, error: assignError } = await supabase.schema("it").rpc("assign_asset", {
    p_asset_id: assetId,
    p_person_id: request.person_id,
    p_condition: optional(formData, "condition"),
    p_remarks: optional(formData, "remarks"),
  });
  if (assignError) go(path, "error", assignError.message);

  const { data: updated, error: updateError } = await supabase
    .schema("it")
    .from("checklist_items")
    .update({ status: "Completed", assignment_id: assignmentId })
    .eq("id", itemId)
    .eq("request_id", requestId)
    .select("id");
  if (updateError) go(path, "error", updateError.message);
  if (!updated?.length) go(path, "error", "Asset assigned, but the task couldn't be marked complete.");

  refresh(requestId);
  go(path, "notice", "Asset assigned and task marked complete.");
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

// Portal-account deactivation for offboarding (IT module revision, part 2). persons.status is
// already checked by proxy.ts and requireActiveUser()/requirePermission() — setting it to
// Inactive here locks the leaver out immediately, same effect as admin/users' setUserStatus but
// gated for the offboarding workflow (it.onboarding.assign) instead of route:/admin/users, which
// an IT Executive wouldn't hold. Deliberately separate from setUserStatus rather than reusing it
// directly, since that action's permission gate doesn't fit this caller.
export async function deactivatePortalAccess(requestId: string) {
  const path = `/it/onboarding/${requestId}`;
  const { supabase, personId: actorId, actorLabel } = await requirePermission("it.onboarding.assign");

  const { data: request } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select("kind, person_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) go(path, "error", "Request not found.");
  if (request.kind !== "Offboarding" || !request.person_id) {
    go(path, "error", "This request has no linked portal account to deactivate.");
  }

  const { data: account } = await supabase
    .from("user_accounts")
    .select("email")
    .eq("person_id", request.person_id)
    .maybeSingle();

  // persons is admin-only under RLS ("persons update by admin") — the app-layer permission
  // check above is the real authorization boundary for this specific, narrow write, same
  // justification as the other documented uses in lib/supabase/admin.ts.
  const { error } = await createAdminClient()
    .from("persons")
    .update({ status: "Inactive" })
    .eq("id", request.person_id);
  if (error) go(path, "error", error.message);

  await logAuditEvent({
    supabase,
    actorId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details: `Deactivated portal access for ${account?.email ?? request.person_id} (offboarding ${requestId})`,
  });

  refresh(requestId);
  go(path, "notice", "Portal access deactivated.");
}

export async function addLifecycleUpdate(requestId: string, formData: FormData) {
  const returnTo = text(formData, "returnTo");
  const back =
    returnTo === "my"
      ? "/it/my-onboarding"
      : returnTo === "my-offboarding"
        ? "/it/my-offboarding"
        : `/it/onboarding/${requestId}`;
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
