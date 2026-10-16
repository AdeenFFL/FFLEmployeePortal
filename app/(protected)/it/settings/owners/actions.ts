"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

// Category owners (plan 08 Phase 6.2). Writable by IT settings admins or the site's IT
// manager(s) — RLS on it.category_owners enforces which (javaria_it_0006); the action only
// requires IT queue access.

const PATH = "/it/settings/owners";

function go(siteId: string, kind: "error" | "notice", message: string): never {
  redirect(`${PATH}?site=${encodeURIComponent(siteId)}&${kind}=${encodeURIComponent(message)}`);
}

function done(siteId: string, message: string): never {
  revalidatePath(PATH);
  go(siteId, "notice", message);
}

export async function addCategoryOwner(siteId: string, categoryId: string, formData: FormData) {
  const { supabase } = await requirePermission("it.tickets.read");
  const personId = String(formData.get("personId") ?? "");
  const makePrimary = formData.get("primary") === "on";
  if (!personId) go(siteId, "error", "Pick a person from this site's IT team.");

  if (makePrimary) {
    // One primary per category × site (partial unique index): clear the current one first.
    const { error: clearError } = await supabase
      .schema("it")
      .from("category_owners")
      .update({ is_primary: false })
      .eq("site_id", siteId)
      .eq("category_id", categoryId)
      .eq("is_primary", true);
    if (clearError) go(siteId, "error", clearError.message);
  }

  const { data, error } = await supabase
    .schema("it")
    .from("category_owners")
    .insert({ site_id: siteId, category_id: categoryId, person_id: personId, is_primary: makePrimary })
    .select("person_id");
  if (error) {
    go(siteId, "error", error.code === "23505" ? "Already an owner of this category." : error.message);
  }
  if (!data?.length) go(siteId, "error", "Only an IT settings admin or this site's IT manager can do that.");

  done(siteId, makePrimary ? "Primary owner set. New tickets here auto-assign to them." : "Owner added.");
}

export async function setPrimaryOwner(siteId: string, categoryId: string, personId: string) {
  const { supabase } = await requirePermission("it.tickets.read");

  const { error: clearError } = await supabase
    .schema("it")
    .from("category_owners")
    .update({ is_primary: false })
    .eq("site_id", siteId)
    .eq("category_id", categoryId)
    .eq("is_primary", true);
  if (clearError) go(siteId, "error", clearError.message);

  const { data, error } = await supabase
    .schema("it")
    .from("category_owners")
    .update({ is_primary: true })
    .eq("site_id", siteId)
    .eq("category_id", categoryId)
    .eq("person_id", personId)
    .select("person_id");
  if (error) go(siteId, "error", error.message);
  if (!data?.length) go(siteId, "error", "Only an IT settings admin or this site's IT manager can do that.");

  done(siteId, "Primary owner changed.");
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
  if (error) go(siteId, "error", error.message);
  if (!data?.length) go(siteId, "error", "Only an IT settings admin or this site's IT manager can do that.");

  done(siteId, "Owner removed.");
}
