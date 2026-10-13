"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { queueItEmails } from "@/lib/it/notifications";
import { TASK_STATUSES, TICKET_PRIORITIES, WORKING_STATUSES } from "@/lib/it/tickets";
import type { ItTicketPriority, ItTicketStatus, ItTicketTaskStatus } from "@/types/database";

// Every action checks its permission here (defense in depth — proxy.ts already gates the page)
// AND is re-checked by the database: RLS decides which rows the caller may touch, and
// it.tickets_before_update() decides which columns (assign/priority/escalate need
// it.tickets.assign, closing needs it.tickets.close). The ticket timeline rows for status,
// assignment, priority and escalation are written by trigger, not here.

function fail(ticketId: string, message: string): never {
  redirect(`/it/tickets/${ticketId}?error=${encodeURIComponent(message)}`);
}

function done(ticketId: string, message: string): never {
  queueItEmails(); // notification rows were written by DB triggers; deliver their emails
  revalidatePath("/it/tickets");
  revalidatePath(`/it/tickets/${ticketId}`);
  revalidatePath(`/it/my-tickets/${ticketId}`);
  redirect(`/it/tickets/${ticketId}?notice=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

// BRD §5.3.5–5.3.7 — IT Executive classifies, prioritises and assigns.
export async function triageTicket(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.assign");

  const priority = text(formData, "priority") as ItTicketPriority;
  if (!TICKET_PRIORITIES.includes(priority)) fail(ticketId, "Invalid priority.");
  const requestTypeId = text(formData, "requestTypeId");
  if (!requestTypeId) fail(ticketId, "Request type is required.");

  const { error } = await supabase
    .schema("it")
    .from("tickets")
    .update({
      assigned_to_person_id: text(formData, "assigneeId") || null,
      priority,
      request_type_id: requestTypeId,
      category_id: text(formData, "categoryId") || null,
      subcategory_id: text(formData, "subcategoryId") || null,
    })
    .eq("id", ticketId);
  if (error) fail(ticketId, error.message);

  done(ticketId, "Ticket updated.");
}

// BRD §5.3.9 — assignee moves the ticket through its working states.
export async function updateTicketStatus(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.update");

  const status = text(formData, "status") as ItTicketStatus;
  if (!WORKING_STATUSES.includes(status)) fail(ticketId, "Invalid status.");

  const { data, error } = await supabase
    .schema("it")
    .from("tickets")
    .update({ status })
    .eq("id", ticketId)
    .select("id");
  if (error) fail(ticketId, error.message);
  if (!data?.length) fail(ticketId, "You can only update tickets assigned to you.");

  done(ticketId, `Status set to ${status}.`);
}

// BRD §5.3.12–5.3.13 — resolution notes are mandatory (also enforced by trigger).
export async function resolveTicket(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.update");

  const resolutionNotes = text(formData, "resolutionNotes");
  if (!resolutionNotes) fail(ticketId, "Resolution notes are required.");

  const { data, error } = await supabase
    .schema("it")
    .from("tickets")
    .update({
      status: "Resolved",
      resolution_notes: resolutionNotes,
      root_cause: text(formData, "rootCause") || null,
    })
    .eq("id", ticketId)
    .select("id");
  if (error) fail(ticketId, error.message);
  if (!data?.length) fail(ticketId, "You can only resolve tickets assigned to you.");

  done(ticketId, "Ticket resolved. The requester has been asked to confirm.");
}

// BRD §5.3.11.
export async function setEscalation(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.assign");

  const escalate = formData.get("escalate") === "true";
  const reason = text(formData, "reason");
  if (escalate && !reason) fail(ticketId, "Please give a reason for escalating.");

  const { error } = await supabase
    .schema("it")
    .from("tickets")
    .update({ is_escalated: escalate, escalation_reason: escalate ? reason : null })
    .eq("id", ticketId);
  if (error) fail(ticketId, error.message);

  done(ticketId, escalate ? "Ticket escalated." : "Escalation cleared.");
}

// BRD §5.3.15 — formal closure by the IT Executive.
export async function closeTicket(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.close");

  const { error } = await supabase
    .schema("it")
    .from("tickets")
    .update({ status: "Closed", closure_remarks: text(formData, "closureRemarks") || null })
    .eq("id", ticketId);
  if (error) fail(ticketId, error.message);

  done(ticketId, "Ticket closed.");
}

// Public reply to the requester, or an internal work note (BRD §5.3.9).
export async function addStaffUpdate(ticketId: string, formData: FormData) {
  const { supabase, personId } = await requirePermission("it.tickets.read");

  const body = text(formData, "body");
  if (!body) fail(ticketId, "Message cannot be empty.");
  const internal = formData.get("visibility") === "internal";

  const { error } = await supabase
    .schema("it")
    .from("ticket_updates")
    .insert({
      ticket_id: ticketId,
      author_person_id: personId,
      update_type: internal ? "work_note" : "comment",
      body,
      is_internal: internal,
    });
  if (error) fail(ticketId, error.message);

  done(ticketId, internal ? "Internal note added." : "Reply sent to the requester.");
}

// ERD ticket_tasks.
export async function addTask(ticketId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.read");

  const taskType = text(formData, "taskType");
  if (!taskType) fail(ticketId, "Task name is required.");

  const { error } = await supabase
    .schema("it")
    .from("ticket_tasks")
    .insert({
      ticket_id: ticketId,
      task_type: taskType,
      description: text(formData, "description") || null,
      assigned_to_person_id: text(formData, "assigneeId") || null,
    });
  if (error) fail(ticketId, error.message);

  done(ticketId, "Task added.");
}

export async function updateTaskStatus(ticketId: string, taskId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.read");

  const status = text(formData, "status") as ItTicketTaskStatus;
  if (!TASK_STATUSES.includes(status)) fail(ticketId, "Invalid task status.");

  const { data, error } = await supabase
    .schema("it")
    .from("ticket_tasks")
    .update({ status })
    .eq("id", taskId)
    .eq("ticket_id", ticketId)
    .select("id");
  if (error) fail(ticketId, error.message);
  if (!data?.length) fail(ticketId, "You can only update tasks assigned to you.");

  done(ticketId, `Task marked ${status}.`);
}
