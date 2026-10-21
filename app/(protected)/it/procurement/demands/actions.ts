"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireActiveUser } from "@/lib/auth/require-user";
import { queueItEmails } from "@/lib/it/notifications";
import { DEMAND_CATEGORIES } from "@/lib/it/procurement";
import type { ItDemand, ItDemandCategory, ItDemandDecision } from "@/types/database";

const DECISIONS: ItDemandDecision[] = ["Approved", "Partially Approved", "Rejected"];

// PRC-03/04/05 (09-it-procurement-plan.md Phase 2). The database decides what's allowed:
// RLS on it.demands + it.demands_before_update() (javaria_it_0010_demands.sql). These actions
// only collect input and turn errors into ?error= messages.

const LIST = "/it/procurement/demands";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function done(path: string, message: string): never {
  revalidatePath(LIST);
  revalidatePath(path);
  queueItEmails();
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function quantity(formData: FormData, path: string) {
  const n = Number(text(formData, "quantity"));
  if (!Number.isInteger(n) || n < 1 || n > 100000) fail(path, "Quantity must be a whole number from 1 to 100,000.");
  return n;
}

// PRC-04 — status, category, vendor and price are set by the database, never by the form.
export async function createDemand(formData: FormData) {
  const NEW = `${LIST}/new`;
  const { supabase, personId } = await requirePermission("it.demands.create");

  const productId = text(formData, "productId");
  const departmentId = text(formData, "departmentId");
  const justification = text(formData, "justification");
  if (!productId) fail(NEW, "Please choose a product.");
  if (!departmentId) fail(NEW, "Please choose the department.");
  if (!justification) fail(NEW, "Please explain why this is needed.");

  const { data: demand, error } = await supabase
    .schema("it")
    .from("demands")
    .insert({
      product_id: productId,
      requested_by_person_id: personId,
      department_id: departmentId,
      site_id: text(formData, "siteId") || undefined,
      quantity: quantity(formData, NEW),
      justification,
    })
    .select("id, demand_number")
    .single();
  if (error || !demand) fail(NEW, error?.message ?? "Could not raise the demand.");

  done(`${LIST}/${demand.id}`, `Demand ${demand.demand_number} raised. Procurement has been notified.`);
}

// Requester or procurement staff, while Open.
export async function editDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requireActiveUser();

  const justification = text(formData, "justification");
  if (!justification) fail(path, "Justification can't be empty.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({
      product_id: text(formData, "productId"),
      department_id: text(formData, "departmentId"),
      quantity: quantity(formData, path),
      justification,
    })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand updated.");
}

// BRD §5.5.2 — Open → Categorized (or a category change while still Categorized).
export async function categorizeDemand(demandId: string, status: ItDemand["status"], formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const category = text(formData, "category") as ItDemandCategory;
  if (!DEMAND_CATEGORIES.some((c) => c.value === category)) fail(path, "Please choose a category.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update(status === "Open" ? { demand_category: category, status: "Categorized" } : { demand_category: category })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, status === "Open" ? "Demand categorised." : "Category changed.");
}

export async function cancelDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requireActiveUser();

  const reason = text(formData, "reason");
  if (!reason) fail(path, "Please give a reason for cancelling.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({ status: "Cancelled", cancellation_reason: reason })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand cancelled.");
}

// BRD §5.5.3 consumable path. Interim until Talha's recordStockMovement() ships (plan §2):
// the stock issue is recorded as a note.
export async function markStockUpdated(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const note = text(formData, "stockNote");
  if (!note) fail(path, "Please note what was issued from stock.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({ status: "Stock Updated", stock_note: note })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Stock entry recorded.");
}

export async function closeDemand(demandId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const { error } = await supabase.schema("it").from("demands").update({ status: "Closed" }).eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand closed.");
}

// BRD §5.5.4 — Categorized → Pending Approval; the database notifies the department's approvers.
export async function submitForApproval(demandId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const { error } = await supabase.schema("it").rpc("submit_demand_for_approval", { p_demand_id: demandId });
  if (error) fail(path, error.message);

  revalidatePath("/it/procurement/approvals");
  done(path, "Sent to the department head for approval.");
}

// BRD §5.5.5 — the approver's decision. Timestamp and approver are captured by the database.
export async function decideDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.approve");

  const decision = text(formData, "decision") as ItDemandDecision;
  if (!DECISIONS.includes(decision)) fail(path, "Please choose a decision.");
  const comments = text(formData, "comments") || null;
  let approvedQuantity: number | null = null;
  if (decision === "Partially Approved") {
    approvedQuantity = Number(text(formData, "approvedQuantity"));
    if (!Number.isInteger(approvedQuantity)) fail(path, "Enter the quantity you approve.");
  }
  if (decision !== "Approved" && !comments) {
    fail(path, decision === "Rejected" ? "Please give a reason for rejecting." : "Please explain the partial approval.");
  }

  const { error } = await supabase.schema("it").rpc("decide_demand", {
    p_demand_id: demandId,
    p_decision: decision,
    p_approved_quantity: approvedQuantity,
    p_comments: comments,
  });
  if (error) fail(path, error.message);

  revalidatePath("/it/procurement/approvals");
  done(path, `Decision recorded: ${decision.toLowerCase()}.`);
}

export async function addDemandComment(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase, personId } = await requireActiveUser();

  const body = text(formData, "body");
  if (!body) fail(path, "Comment can't be empty.");
  const internal = formData.get("internal") === "on";

  const { error } = await supabase.schema("it").from("demand_updates").insert({
    demand_id: demandId,
    author_person_id: personId,
    update_type: internal ? "work_note" : "comment",
    body,
    is_internal: internal,
  });
  if (error) fail(path, error.message);

  revalidatePath(path);
  queueItEmails();
  redirect(path);
}
