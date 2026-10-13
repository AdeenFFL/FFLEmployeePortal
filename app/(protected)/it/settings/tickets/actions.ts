"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItRequestTypeAppliesTo, ItTicketPriority } from "@/types/database";

// ITSM-01 — ticket master data (plan 08 Phase 2). No migration needed: the write policies on
// it.sla_policies / it.request_types / it.ticket_categories (javaria_it_0001) already require
// it.ticket_settings.update, checked again here as defense in depth.

const PATH = "/it/settings/tickets";
const APPLIES_TO: ItRequestTypeAppliesTo[] = ["Ticket", "Onboarding", "Offboarding", "Replacement"];

function go(kind: "error" | "notice", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  revalidatePath(PATH);
  revalidatePath("/it/my-tickets/new");
  revalidatePath("/it/tickets");
  go("notice", message);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function hours(formData: FormData, key: string) {
  const value = Number(text(formData, key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// BRD §5.3.8. Due dates are stamped when a ticket is created (or re-prioritised), so a change
// here applies to new tickets only — existing tickets keep the SLA they were raised under.
export async function updateSlaPolicy(priority: ItTicketPriority, formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  if (!TICKET_PRIORITIES.includes(priority)) go("error", "Unknown priority.");

  const responseHours = hours(formData, "responseHours");
  const resolutionHours = hours(formData, "resolutionHours");
  if (responseHours === null || resolutionHours === null) {
    go("error", "Hours must be numbers greater than zero.");
  }
  if (resolutionHours < responseHours) {
    go("error", "Resolution time can't be shorter than response time.");
  }

  const { error } = await supabase
    .schema("it")
    .from("sla_policies")
    .upsert({ priority, response_hours: responseHours, resolution_hours: resolutionHours });
  if (error) go("error", error.message);

  done(`${priority} SLA updated. New tickets will use it.`);
}

export async function createRequestType(formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  const appliesTo = text(formData, "appliesTo") as ItRequestTypeAppliesTo;
  if (!name) go("error", "Request type name is required.");
  if (!APPLIES_TO.includes(appliesTo)) go("error", "Choose what the type applies to.");

  const { error } = await supabase
    .schema("it")
    .from("request_types")
    .insert({ name, applies_to: appliesTo, description: text(formData, "description") || null });
  if (error) {
    go("error", error.code === "23505" ? `A request type called "${name}" already exists.` : error.message);
  }

  done(`Request type "${name}" added.`);
}

export async function updateRequestType(id: string, formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  if (!name) go("error", "Request type name is required.");

  const { error } = await supabase
    .schema("it")
    .from("request_types")
    .update({ name, description: text(formData, "description") || null })
    .eq("id", id);
  if (error) {
    go("error", error.code === "23505" ? `A request type called "${name}" already exists.` : error.message);
  }

  done(`Request type "${name}" saved.`);
}

// Types and categories are deactivated, never deleted: existing tickets and requests still
// reference them (FK), and history must keep showing the original name.
export async function setRequestTypeActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const { error } = await supabase
    .schema("it")
    .from("request_types")
    .update({ is_active: active })
    .eq("id", id);
  if (error) go("error", error.message);

  done(active ? "Request type activated." : "Request type hidden from new requests.");
}

export async function createCategory(formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  const parentId = text(formData, "parentId") || null;
  if (!name) go("error", "Name is required.");

  const sortOrder = Number(text(formData, "sortOrder"));
  const { error } = await supabase
    .schema("it")
    .from("ticket_categories")
    .insert({
      name,
      parent_id: parentId,
      description: text(formData, "description") || null,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
  if (error) {
    go("error", error.code === "23505" ? `"${name}" already exists there.` : error.message);
  }

  done(parentId ? `Subcategory "${name}" added.` : `Category "${name}" added.`);
}

export async function updateCategory(id: string, formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  if (!name) go("error", "Name is required.");

  const sortOrder = Number(text(formData, "sortOrder"));
  const { error } = await supabase
    .schema("it")
    .from("ticket_categories")
    .update({
      name,
      description: text(formData, "description") || null,
      ...(Number.isFinite(sortOrder) ? { sort_order: sortOrder } : {}),
    })
    .eq("id", id);
  if (error) {
    go("error", error.code === "23505" ? `"${name}" already exists there.` : error.message);
  }

  done(`"${name}" saved.`);
}

export async function setCategoryActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const { error } = await supabase
    .schema("it")
    .from("ticket_categories")
    .update({ is_active: active })
    .eq("id", id);
  if (error) go("error", error.message);

  done(active ? "Category activated." : "Category hidden from new tickets.");
}
