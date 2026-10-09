"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";

export async function createTicket(formData: FormData) {
  const { supabase, personId } = await requireActiveUser();

  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!subject || !body) throw new Error("Subject and description are required.");

  // Denormalized at creation time per 01-platform-design-and-sop.md §7 — cheap filtering by
  // site/company later without joining back through persons on every query.
  const { data: person } = await supabase
    .from("persons")
    .select("company_id, site_id")
    .eq("id", personId)
    .maybeSingle();

  const { data: ticket, error } = await supabase
    .schema("hr")
    .from("tickets")
    .insert({
      person_id: personId,
      category_id: categoryId,
      subject,
      body,
      company_id: person?.company_id ?? null,
      site_id: person?.site_id ?? null,
      created_by: personId,
      updated_by: personId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/hr/tickets");
  redirect(`/hr/tickets/${ticket.id}`);
}

export async function replyToTicket(ticketId: string, formData: FormData) {
  const { supabase, personId } = await requireActiveUser();

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Message cannot be empty.");

  const { error } = await supabase
    .schema("hr")
    .from("ticket_messages")
    .insert({ ticket_id: ticketId, sender_person_id: personId, body });
  if (error) throw new Error(error.message);

  // Not updating tickets.updated_by here: RLS on hr.tickets' update policy only allows HR
  // staff (has_permission('hr.manage_tickets')) to update the ticket row itself — a submitter
  // replying to their own ticket can insert a message but can't touch the ticket row. That's
  // fine; updated_by/updated_at tracks HR-side changes (status, assignment), not every reply.
  revalidatePath(`/hr/tickets/${ticketId}`);
  revalidatePath(`/hr/feedback/${ticketId}`);
}
