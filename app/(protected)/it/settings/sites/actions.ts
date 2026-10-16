"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import type { ItSiteRole } from "@/types/database";

// Sites & IT staff (plan 08 Phase 6.1). Writes are RLS-gated by it.ticket_settings.update
// (javaria_it_0005_site_routing.sql), checked here too.

const PATH = "/it/settings/sites";
const ROLES: ItSiteRole[] = ["manager", "member"];

function go(kind: "error" | "notice", message: string, siteId?: string): never {
  const site = siteId ? `&site=${encodeURIComponent(siteId)}` : "";
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}${site}`);
}

function done(message: string, siteId?: string): never {
  revalidatePath(PATH);
  revalidatePath("/it/tickets");
  go("notice", message, siteId);
}

export async function setHqSite(formData: FormData) {
  const { supabase, personId } = await requirePermission("it.ticket_settings.update");
  const siteId = String(formData.get("hqSiteId") ?? "") || null;

  const { error } = await supabase
    .schema("it")
    .from("settings")
    .update({ hq_site_id: siteId, updated_by: personId })
    .eq("id", true);
  if (error) go("error", error.message);

  done(siteId ? "HQ site saved. HQ-handled tickets now route there." : "HQ site cleared.");
}

export async function addSiteStaff(siteId: string, formData: FormData) {
  const { supabase, personId } = await requirePermission("it.ticket_settings.update");
  const staffId = String(formData.get("personId") ?? "");
  const role = String(formData.get("role") ?? "member") as ItSiteRole;
  if (!staffId) go("error", "Select a person.", siteId);
  if (!ROLES.includes(role)) go("error", "Invalid role.", siteId);

  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .insert({ site_id: siteId, person_id: staffId, role, created_by: personId });
  if (error) {
    go("error", error.code === "23505" ? "That person is already on this site's IT team." : error.message, siteId);
  }

  done(role === "manager" ? "Site IT manager added." : "IT team member added.", siteId);
}

export async function setSiteStaffRole(siteId: string, staffId: string, role: ItSiteRole) {
  const { supabase } = await requirePermission("it.ticket_settings.update");
  if (!ROLES.includes(role)) go("error", "Invalid role.", siteId);

  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .update({ role })
    .eq("site_id", siteId)
    .eq("person_id", staffId);
  if (error) go("error", error.message, siteId);

  done(role === "manager" ? "Now a site IT manager." : "Now an IT team member.", siteId);
}

export async function removeSiteStaff(siteId: string, staffId: string) {
  const { supabase } = await requirePermission("it.ticket_settings.update");

  const { error } = await supabase
    .schema("it")
    .from("site_it_staff")
    .delete()
    .eq("site_id", siteId)
    .eq("person_id", staffId);
  if (error) go("error", error.message, siteId);

  done("Removed from the site's IT team. Their assigned tickets stay assigned.", siteId);
}
