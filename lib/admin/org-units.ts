"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditEvent } from "@/lib/audit/log";
import type { OrgUnitType } from "@/types/database";

const PATH_BY_TYPE: Record<OrgUnitType, string> = {
  Department: "/admin/departments",
  Site: "/admin/sites",
};

function readOrgUnitFormFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    short_code: String(formData.get("short_code") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    is_active: formData.get("is_active") === "on",
  };
}

export async function createOrUpdateOrgUnit(type: OrgUnitType, formData: FormData) {
  const { supabase, personId, actorLabel } = await requireAdmin();
  const path = PATH_BY_TYPE[type];
  const id = String(formData.get("id") ?? "").trim() || null;
  const fields = readOrgUnitFormFields(formData);
  if (!fields.name) throw new Error("Name is required.");

  if (id) {
    const { error } = await supabase
      .from("org_units")
      .update(fields)
      .eq("id", id)
      .eq("type", type);
    if (error) throw new Error(error.message);
    await logAuditEvent({
      supabase,
      actorId: personId,
      actorLabel,
      module: "admin",
      action: "MODIFIED",
      details: `Updated ${type.toLowerCase()} '${fields.name}'`,
    });
  } else {
    const { error } = await supabase.from("org_units").insert({ ...fields, type });
    if (error) throw new Error(error.message);
    await logAuditEvent({
      supabase,
      actorId: personId,
      actorLabel,
      module: "admin",
      action: "CREATED",
      details: `Created ${type.toLowerCase()} '${fields.name}'`,
    });
  }

  revalidatePath(path);
}

export async function setOrgUnitStatus(type: OrgUnitType, id: string, isActive: boolean) {
  const { supabase, personId, actorLabel } = await requireAdmin();

  const { data: unit } = await supabase
    .from("org_units")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("org_units")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "admin",
    action: "MODIFIED",
    details: `Changed '${unit?.name ?? id}' status: ${
      isActive ? "Inactive → Active" : "Active → Inactive"
    }`,
  });

  revalidatePath(PATH_BY_TYPE[type]);
}
