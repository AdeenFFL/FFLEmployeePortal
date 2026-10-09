"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";
import type { TicketStatus } from "@/types/database";

const VALID_STATUSES: TicketStatus[] = ["Open", "In Progress", "Resolved", "Closed"];

export async function updateTicketStatus(ticketId: string, formData: FormData) {
  const { supabase, personId } = await requirePermission("hr.manage_tickets");

  const rawStatus = String(formData.get("status") ?? "").trim();
  if (!VALID_STATUSES.includes(rawStatus as TicketStatus)) {
    throw new Error("Invalid status.");
  }
  const status = rawStatus as TicketStatus;

  const { error } = await supabase
    .schema("hr")
    .from("tickets")
    .update({ status, updated_by: personId })
    .eq("id", ticketId);
  if (error) throw new Error(error.message);

  revalidatePath(`/hr/tickets/${ticketId}`);
  revalidatePath("/hr/feedback");
}

export async function assignTicket(ticketId: string, formData: FormData) {
  const { supabase, personId } = await requirePermission("hr.manage_tickets");

  const assignedTo = String(formData.get("assignedToPersonId") ?? "").trim() || null;

  const { error } = await supabase
    .schema("hr")
    .from("tickets")
    .update({ assigned_to_person_id: assignedTo, updated_by: personId })
    .eq("id", ticketId);
  if (error) throw new Error(error.message);

  revalidatePath(`/hr/tickets/${ticketId}`);
  revalidatePath("/hr/feedback");
}
