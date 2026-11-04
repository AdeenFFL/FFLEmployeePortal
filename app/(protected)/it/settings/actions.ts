"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItRequestTypeAppliesTo, ItTicketPriority } from "@/types/database";

// Unified IT Settings (/it/settings) — consolidates what used to be
// settings/tickets/actions.ts, settings/sites/actions.ts, settings/owners/actions.ts and
// settings/onboarding-owners/actions.ts. Every action here is called directly from a client
// component (OptimisticToggle / AutoSaveField / AutoSaveSelect / OwnerChips / AddRowForm) instead
// of a <form action> that redirects — so on failure these THROW (the caller catches and shows the
// error inline / reverts its optimistic state) and on success they just revalidatePath. RLS is
// still the real authorization boundary; requirePermission here is defense in depth, same as
// before.

const PATH = "/it/settings";
const APPLIES_TO: ItRequestTypeAppliesTo[] = ["Ticket", "Onboarding", "Offboarding", "Replacement"];

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function refresh(...extraPaths: string[]) {
  revalidatePath(PATH);
  for (const p of extraPaths) revalidatePath(p);
}

// ===========================================================================
// SLA targets
// ===========================================================================

export async function updateSlaField(priority: ItTicketPriority, field: "response" | "resolution", valueStr: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  if (!TICKET_PRIORITIES.includes(priority)) throw new Error("Unknown priority.");

  const value = Number(valueStr);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Hours must be a number greater than zero.");

  const { data: current } = await supabase
    .schema("it")
    .from("sla_policies")
    .select("response_hours, resolution_hours")
    .eq("priority", priority)
    .maybeSingle();

  const responseHours = field === "response" ? value : (current?.response_hours ?? value);
  const resolutionHours = field === "resolution" ? value : (current?.resolution_hours ?? value);
  if (resolutionHours < responseHours) {
    throw new Error("Resolution time can't be shorter than response time.");
  }

  const { error } = await supabase
    .schema("it")
    .from("sla_policies")
    .upsert({ priority, response_hours: responseHours, resolution_hours: resolutionHours });
  if (error) throw new Error(error.message);

  refresh();
}

// ===========================================================================
// Request types
// ===========================================================================

export async function createRequestType(formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  const appliesTo = text(formData, "appliesTo") as ItRequestTypeAppliesTo;
  if (!name) throw new Error("Request type name is required.");
  if (!APPLIES_TO.includes(appliesTo)) throw new Error("Choose what the type applies to.");

  const { error } = await supabase
    .schema("it")
    .from("request_types")
    .insert({ name, applies_to: appliesTo, description: text(formData, "description") || null });
  if (error) {
    throw new Error(error.code === "23505" ? `A request type called "${name}" already exists.` : error.message);
  }

  refresh();
}

export async function updateRequestTypeName(id: string, name: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Request type name is required.");

  const { error } = await supabase.schema("it").from("request_types").update({ name: trimmed }).eq("id", id);
  if (error) {
    throw new Error(error.code === "23505" ? `A request type called "${trimmed}" already exists.` : error.message);
  }
  refresh();
}

export async function updateRequestTypeDescription(id: string, description: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase
    .schema("it")
    .from("request_types")
    .update({ description: description.trim() || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setRequestTypeActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase.schema("it").from("request_types").update({ is_active: active }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

// ===========================================================================
// Categories & subcategories
// ===========================================================================

export async function createCategory(formData: FormData) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const name = text(formData, "name");
  const parentId = text(formData, "parentId") || null;
  if (!name) throw new Error("Name is required.");

  const sortOrder = Number(text(formData, "sortOrder"));
  const { error } = await supabase
    .schema("it")
    .from("ticket_categories")
    .insert({
      name,
      parent_id: parentId,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
  if (error) throw new Error(error.code === "23505" ? `"${name}" already exists there.` : error.message);

  refresh();
}

export async function updateCategoryName(id: string, name: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required.");

  const { error } = await supabase.schema("it").from("ticket_categories").update({ name: trimmed }).eq("id", id);
  if (error) throw new Error(error.code === "23505" ? `"${trimmed}" already exists there.` : error.message);
  refresh();
}

export async function updateCategorySortOrder(id: string, sortOrderStr: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const sortOrder = Number(sortOrderStr);
  if (!Number.isFinite(sortOrder)) throw new Error("Sort order must be a number.");

  const { error } = await supabase.schema("it").from("ticket_categories").update({ sort_order: sortOrder }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setCategoryActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase.schema("it").from("ticket_categories").update({ is_active: active }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function setCategoryNeedsAccessField(id: string, needsAccessField: boolean) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase
    .schema("it")
    .from("ticket_categories")
    .update({ needs_access_field: needsAccessField })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

// ===========================================================================
// Category owners (site-scoped — 0038_it_owners_and_assignees.sql)
// ===========================================================================

export async function addCategoryOwner(siteId: string, categoryId: string, personId: string, makePrimary: boolean) {
  const { supabase } = await requirePermission("it.tickets.read");

  if (makePrimary) {
    const { error: clearError } = await supabase
      .schema("it")
      .from("category_owners")
      .update({ is_primary: false })
      .eq("site_id", siteId)
      .eq("category_id", categoryId)
      .eq("is_primary", true);
    if (clearError) throw new Error(clearError.message);
  }

  const { data, error } = await supabase
    .schema("it")
    .from("category_owners")
    .insert({ site_id: siteId, category_id: categoryId, person_id: personId, is_primary: makePrimary })
    .select("person_id");
  if (error) throw new Error(error.code === "23505" ? "Already an owner of this category." : error.message);
  if (!data?.length) throw new Error("Only an IT settings admin or this site's IT manager can do that.");

  refresh();
}

export async function setPrimaryCategoryOwner(siteId: string, categoryId: string, personId: string) {
  const { supabase } = await requirePermission("it.tickets.read");

  const { error: clearError } = await supabase
    .schema("it")
    .from("category_owners")
    .update({ is_primary: false })
    .eq("site_id", siteId)
    .eq("category_id", categoryId)
    .eq("is_primary", true);
  if (clearError) throw new Error(clearError.message);

  const { data, error } = await supabase
    .schema("it")
    .from("category_owners")
    .update({ is_primary: true })
    .eq("site_id", siteId)
    .eq("category_id", categoryId)
    .eq("person_id", personId)
    .select("person_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only an IT settings admin or this site's IT manager can do that.");

  refresh();
}

export async function removeCategoryOwner(siteId: string, categoryId: string, personId: string) {
  const { supabase } = await requirePermission("it.tickets.read");

  const { data, error } = await supabase
    .schema("it")
    .from("category_owners")
    .delete()
    .eq("site_id", siteId)
    .eq("category_id", categoryId)
    .eq("person_id", personId)
    .select("person_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only an IT settings admin or this site's IT manager can do that.");

  refresh();
}

// ===========================================================================
// Onboarding task-type owners (site-scoped — 0052_it_onboarding_site_scoping.sql)
// ===========================================================================

export async function addTaskTypeOwner(siteId: string, taskType: string, personId: string, makePrimary: boolean) {
  const { supabase } = await requirePermission("it.onboarding.assign");

  if (makePrimary) {
    const { error: clearError } = await supabase
      .schema("it")
      .from("task_type_owners")
      .update({ is_primary: false })
      .eq("site_id", siteId)
      .eq("task_type", taskType)
      .eq("is_primary", true);
    if (clearError) throw new Error(clearError.message);
  }

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .insert({ site_id: siteId, task_type: taskType, person_id: personId, is_primary: makePrimary })
    .select("person_id");
  if (error) throw new Error(error.code === "23505" ? "Already an owner of this task type." : error.message);
  if (!data?.length) throw new Error("Only someone who can assign onboarding tasks can do that.");

  refresh("/it/onboarding");
}

export async function setPrimaryTaskTypeOwner(siteId: string, taskType: string, personId: string) {
  const { supabase } = await requirePermission("it.onboarding.assign");

  const { error: clearError } = await supabase
    .schema("it")
    .from("task_type_owners")
    .update({ is_primary: false })
    .eq("site_id", siteId)
    .eq("task_type", taskType)
    .eq("is_primary", true);
  if (clearError) throw new Error(clearError.message);

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .update({ is_primary: true })
    .eq("site_id", siteId)
    .eq("task_type", taskType)
    .eq("person_id", personId)
    .select("person_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only someone who can assign onboarding tasks can do that.");

  refresh("/it/onboarding");
}

export async function removeTaskTypeOwner(siteId: string, taskType: string, personId: string) {
  const { supabase } = await requirePermission("it.onboarding.assign");

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .delete()
    .eq("site_id", siteId)
    .eq("task_type", taskType)
    .eq("person_id", personId)
    .select("person_id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only someone who can assign onboarding tasks can do that.");

  refresh("/it/onboarding");
}

// ===========================================================================
// Sites & IT staff
// ===========================================================================

// Person-centric site assignment (IT Module: department-based IT staff). The eligible pool is no
// longer "any employee found via search" — it.site_it_staff's own insert/update trigger
// (it.check_site_it_staff_department, 0054) rejects anyone not in the IT department regardless of
// how the row gets written, so this is defense in depth, same shape as every other action here.
export async function assignSiteToStaff(personId: string, siteId: string, role: "manager" | "member") {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .insert({ site_id: siteId, person_id: personId, role });
  if (error) {
    throw new Error(error.code === "23505" ? "Already assigned to this site." : error.message);
  }
  refresh();
}

export async function setSiteAssignmentRole(personId: string, siteId: string, role: "manager" | "member") {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .update({ role })
    .eq("site_id", siteId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
  refresh();
}

export async function removeSiteAssignment(personId: string, siteId: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .delete()
    .eq("site_id", siteId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
  refresh();
}
