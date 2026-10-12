"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireActiveUser } from "@/lib/auth/require-user";
import { ATTACHMENT_BUCKET } from "@/lib/it/ticket-data";
import {
  CONTACT_METHODS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  TICKET_PRIORITIES,
} from "@/lib/it/tickets";
import type { ItContactMethod, ItTicketPriority } from "@/types/database";

// Validation failures come back to the page as ?error=… instead of a thrown error, so the
// employee sees a message next to the form rather than the generic error screen. redirect()
// throws internally, so these helpers are never called inside a try/catch.
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100) || "file";
}

// SCR-01 — BRD §5.3.1 form. Workflow fields (status, assignee, SLA dates, …) are never taken
// from the form: it.tickets_before_insert() resets them regardless of what's sent.
export async function createItTicket(formData: FormData) {
  const NEW = "/it/my-tickets/new";
  const { supabase, personId } = await requirePermission("module:it");

  const requestTypeId = text(formData, "requestTypeId");
  const subject = text(formData, "subject");
  const description = text(formData, "description");
  const priority = text(formData, "priority") as ItTicketPriority;
  const contactMethod = (text(formData, "preferredContactMethod") || "Portal") as ItContactMethod;

  if (!requestTypeId) fail(NEW, "Please choose a request type.");
  if (!subject) fail(NEW, "Please enter a subject.");
  if (!description) fail(NEW, "Please describe the issue or request.");
  if (!TICKET_PRIORITIES.includes(priority)) fail(NEW, "Please choose a priority.");
  if (!CONTACT_METHODS.includes(contactMethod)) fail(NEW, "Invalid contact method.");

  const files = formData
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ATTACHMENTS) fail(NEW, `Attach at most ${MAX_ATTACHMENTS} files.`);
  if (files.some((f) => f.size > MAX_ATTACHMENT_BYTES)) {
    fail(NEW, "Each attachment must be 5 MB or smaller.");
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    fail(NEW, "Attachments must be 8 MB or smaller in total.");
  }

  // company_id copied from the requester at creation (SOP §7 scoping column).
  const { data: person } = await supabase
    .from("persons")
    .select("company_id, site_id")
    .eq("id", personId)
    .maybeSingle();

  const { data: ticket, error } = await supabase
    .schema("it")
    .from("tickets")
    .insert({
      requester_person_id: personId,
      request_type_id: requestTypeId,
      category_id: optional(formData, "categoryId"),
      subcategory_id: optional(formData, "subcategoryId"),
      priority,
      subject,
      description,
      site_id: optional(formData, "siteId") ?? person?.site_id ?? null,
      department_id: optional(formData, "departmentId"),
      company_id: person?.company_id ?? null,
      asset_system_name: optional(formData, "assetSystemName"),
      access_required: optional(formData, "accessRequired"),
      manager_approval_required: formData.get("managerApprovalRequired") === "on",
      preferred_contact_method: contactMethod,
      remarks: optional(formData, "remarks"),
    })
    .select("id, ticket_number")
    .single();
  if (error || !ticket) fail(NEW, error?.message ?? "Could not create the ticket.");

  // The ticket is already saved; an upload failure shouldn't lose it. Report it instead.
  let failedUploads = 0;
  for (const file of files) {
    const path = `${ticket.id}/${randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      failedUploads++;
      continue;
    }
    const { error: rowError } = await supabase.schema("it").from("ticket_attachments").insert({
      ticket_id: ticket.id,
      storage_path: path,
      file_name: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: personId,
    });
    if (rowError) failedUploads++;
  }

  revalidatePath("/it/my-tickets");
  revalidatePath("/it/tickets");

  const notice =
    failedUploads > 0
      ? `Ticket ${ticket.ticket_number} created, but ${failedUploads} attachment(s) could not be uploaded.`
      : `Ticket ${ticket.ticket_number} created. IT has been notified.`;
  redirect(`/it/my-tickets/${ticket.id}?notice=${encodeURIComponent(notice)}`);
}

export async function addRequesterComment(ticketId: string, formData: FormData) {
  const path = `/it/my-tickets/${ticketId}`;
  const { supabase, personId } = await requireActiveUser();

  const body = text(formData, "body");
  if (!body) fail(path, "Comment cannot be empty.");

  const { error } = await supabase.schema("it").from("ticket_updates").insert({
    ticket_id: ticketId,
    author_person_id: personId,
    update_type: "comment",
    body,
    is_internal: false,
  });
  if (error) fail(path, error.message);

  revalidatePath(path);
  revalidatePath(`/it/tickets/${ticketId}`);
}

// BRD §5.3.14 — requester confirms the fix and rates it.
export async function confirmResolution(ticketId: string, formData: FormData) {
  const path = `/it/my-tickets/${ticketId}`;
  const { supabase } = await requireActiveUser();

  const rating = Number(formData.get("rating"));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    fail(path, "Please rate the support from 1 to 5.");
  }

  const { error } = await supabase.schema("it").rpc("confirm_ticket_resolution", {
    p_ticket_id: ticketId,
    p_rating: rating,
    p_comment: optional(formData, "comment"),
  });
  if (error) fail(path, error.message);

  revalidatePath(path);
  revalidatePath(`/it/tickets/${ticketId}`);
  redirect(`${path}?notice=${encodeURIComponent("Thanks — your confirmation has been sent to IT.")}`);
}

// BRD §5.3.14 — the fix didn't work; back to IT.
export async function reopenTicket(ticketId: string, formData: FormData) {
  const path = `/it/my-tickets/${ticketId}`;
  const { supabase } = await requireActiveUser();

  const reason = text(formData, "reason");
  if (!reason) fail(path, "Please say why you're reopening the ticket.");

  const { error } = await supabase
    .schema("it")
    .rpc("reopen_ticket", { p_ticket_id: ticketId, p_reason: reason });
  if (error) fail(path, error.message);

  revalidatePath(path);
  revalidatePath("/it/tickets");
  redirect(`${path}?notice=${encodeURIComponent("Ticket reopened and sent back to IT.")}`);
}
