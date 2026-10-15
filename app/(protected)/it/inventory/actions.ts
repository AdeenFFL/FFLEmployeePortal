"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAuditEvent } from "@/lib/audit/log";
import type { Asset } from "@/types/database";
import {
  MANUAL_STATUSES,
  RETURN_STATUSES,
  SYSTEM_MANAGED_STATUSES,
  type ReturnStatus,
} from "./asset-status";

export type AssetFormState = { error: string | null };

function text(formData: FormData, field: string) {
  return String(formData.get(field) ?? "").trim();
}

function optionalText(formData: FormData, field: string) {
  return text(formData, field) || null;
}

// The editable columns, shared by create and update. Status, vendor and receipt are never taken
// from this form: status has its own flows, and vendor/receipt arrive with procurement (Phase 7).
// The tag is typed by hand (decision 5, 2026-10-14) with no enforced format.
function readAssetFields(formData: FormData) {
  const fields = {
    asset_tag: text(formData, "asset_tag"),
    asset_name: text(formData, "asset_name"),
    serial_number: text(formData, "serial_number"),
    asset_type_id: text(formData, "asset_type_id"),
    company_id: text(formData, "company_id"),
    site_id: optionalText(formData, "site_id"),
    manufacturer: optionalText(formData, "manufacturer"),
    model_number: optionalText(formData, "model_number"),
    purchase_date: optionalText(formData, "purchase_date"),
    condition: optionalText(formData, "condition"),
    warranty_expiry: optionalText(formData, "warranty_expiry"),
    notes: optionalText(formData, "notes"),
  };

  if (!fields.asset_tag) {
    return { ok: false, error: "Asset tag is required." } as const;
  }
  if (!fields.asset_name || !fields.serial_number || !fields.asset_type_id || !fields.company_id) {
    return { ok: false, error: "Asset name, type, serial number and company are required." } as const;
  }
  if (fields.purchase_date && fields.warranty_expiry && fields.warranty_expiry < fields.purchase_date) {
    return { ok: false, error: "Warranty expiry can't be before the purchase date." } as const;
  }
  return { ok: true, fields } as const;
}

// 23505 = unique_violation: uq_assets_serial_live (serial already on a non-deleted asset).
function serialTakenMessage(serialNumber: string) {
  return `An asset with serial number "${serialNumber}" already exists.`;
}

function tagTakenMessage(assetTag: string, maybeDeleted: boolean) {
  return maybeDeleted
    ? `An asset with tag "${assetTag}" already exists (it may be a deleted asset).`
    : `An asset with tag "${assetTag}" already exists.`;
}

// Tags must be unique ignoring case (uq_assets_asset_tag_ci in talha_it_0007). Checked here too so
// the message is clear even before that index is applied. Deleted assets keep their tag, so they
// count. Returns the error message, or null when the tag is free.
async function findTagConflict(
  supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"],
  assetTag: string,
  excludeAssetId?: string,
) {
  // ilike without wildcards = case-insensitive equality; escape the LIKE special characters.
  const pattern = assetTag.replace(/[\\%_]/g, (c) => `\\${c}`);
  let query = supabase.schema("it").from("assets").select("id, deleted_at").ilike("asset_tag", pattern);
  if (excludeAssetId) query = query.neq("id", excludeAssetId);
  const { data } = await query.limit(1);
  const match = data?.[0];
  return match ? tagTakenMessage(assetTag, match.deleted_at !== null) : null;
}

// Fallback for a 23505 the pre-check didn't catch (e.g. a deleted asset RLS hides from us):
// the constraint name in the message says whether the tag or the serial clashed.
function uniqueViolationMessage(message: string, fields: { asset_tag: string; serial_number: string }) {
  return message.includes("asset_tag")
    ? tagTakenMessage(fields.asset_tag, true)
    : serialTakenMessage(fields.serial_number);
}

// Returns errors as state (useActionState) instead of throwing: in production Next.js hides a
// thrown Server Action error's message, so "serial number already exists" would otherwise
// reach the user as a generic error page.
export async function createAsset(
  _prevState: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const { supabase, personId, actorLabel } = await requirePermission("it.assets.create");

  const parsed = readAssetFields(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { fields } = parsed;

  const { data: assetType } = await supabase
    .schema("it")
    .from("asset_types")
    .select("is_active")
    .eq("id", fields.asset_type_id)
    .maybeSingle();
  if (!assetType?.is_active) return { error: "Choose an active asset type." };

  const tagConflict = await findTagConflict(supabase, fields.asset_tag);
  if (tagConflict) return { error: tagConflict };

  // status defaults to Unassigned in the database and is never accepted from the form.
  const { data: asset, error } = await supabase
    .schema("it")
    .from("assets")
    .insert({ ...fields, created_by: personId, updated_by: personId })
    .select("asset_tag")
    .single();
  if (error?.code === "23505") return { error: uniqueViolationMessage(error.message, fields) };
  if (error) return { error: error.message };

  // audit_log's insert policy is currently admin-only (0004), so this records nothing for
  // non-admin IT staff — see 07-it-inventory-plan.md §8 (4b).
  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "CREATED",
    details: `Registered asset ${asset.asset_tag} (${fields.asset_name}, serial ${fields.serial_number})`,
  });

  revalidatePath("/it/inventory");
  redirect(`/it/inventory?created=${encodeURIComponent(asset.asset_tag)}`);
}

// Bound to the asset id by the edit page: updateAsset.bind(null, assetId).
export async function updateAsset(
  assetId: string,
  _prevState: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const { supabase, personId, actorLabel } = await requirePermission("it.assets.update");

  const parsed = readAssetFields(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { fields } = parsed;

  const { data: current } = await supabase
    .schema("it")
    .from("assets")
    .select("asset_tag, asset_type_id")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return { error: "This asset no longer exists." };

  // An asset may keep a type that has since been deactivated; only a *change* of type has to
  // pick an active one.
  if (fields.asset_type_id !== current.asset_type_id) {
    const { data: assetType } = await supabase
      .schema("it")
      .from("asset_types")
      .select("is_active")
      .eq("id", fields.asset_type_id)
      .maybeSingle();
    if (!assetType?.is_active) return { error: "Choose an active asset type." };
  }

  const tagConflict = await findTagConflict(supabase, fields.asset_tag, assetId);
  if (tagConflict) return { error: tagConflict };

  // .select() so an update that RLS silently filtered out (0 rows) is reported, not ignored.
  const { data: updated, error } = await supabase
    .schema("it")
    .from("assets")
    .update({ ...fields, updated_by: personId })
    .eq("id", assetId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return { error: uniqueViolationMessage(error.message, fields) };
  if (error) return { error: error.message };
  if (!updated) return { error: "You don't have permission to edit this asset." };

  const tagChange =
    current.asset_tag !== fields.asset_tag ? `, tag ${current.asset_tag} → ${fields.asset_tag}` : "";
  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details: `Edited asset ${fields.asset_tag} (${fields.asset_name}${tagChange})`,
  });

  revalidatePath("/it/inventory");
  revalidatePath(`/it/inventory/${assetId}`);
  redirect(
    `/it/inventory/${assetId}?notice=${encodeURIComponent(`Asset ${fields.asset_tag} updated.`)}`,
  );
}

function detailUrl(assetId: string, kind: "notice" | "error", message: string) {
  return `/it/inventory/${assetId}?${kind}=${encodeURIComponent(message)}`;
}

// Manual status changes only (Retired / Disposed / Lost / back to Unassigned). "In Use" and
// "In Repair" belong to the assignment (Phase 3) and maintenance (Phase 4) flows, so an asset
// in either can't be moved by hand — that would leave an open assignment or repair behind.
export async function changeAssetStatus(assetId: string, formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission("it.assets.update");

  const newStatus = text(formData, "status") as Asset["status"];
  const reason = text(formData, "reason");
  if (!MANUAL_STATUSES.includes(newStatus)) {
    redirect(detailUrl(assetId, "error", "Choose a valid status."));
  }

  const { data: current } = await supabase
    .schema("it")
    .from("assets")
    .select("asset_tag, status")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) redirect(detailUrl(assetId, "error", "This asset no longer exists."));
  if (SYSTEM_MANAGED_STATUSES.includes(current.status)) {
    redirect(
      detailUrl(assetId, "error", `An asset that is ${current.status} can't be changed by hand.`),
    );
  }
  if (current.status === newStatus) {
    redirect(detailUrl(assetId, "error", `The asset is already ${newStatus}.`));
  }

  const { data: updated, error } = await supabase
    .schema("it")
    .from("assets")
    .update({ status: newStatus, updated_by: personId })
    .eq("id", assetId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) redirect(detailUrl(assetId, "error", error.message));
  if (!updated) redirect(detailUrl(assetId, "error", "You don't have permission to change this asset."));

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details:
      `Asset ${current.asset_tag}: ${current.status} → ${newStatus}` +
      (reason ? ` (reason: ${reason})` : ""),
  });

  revalidatePath("/it/inventory");
  revalidatePath(`/it/inventory/${assetId}`);
  redirect(detailUrl(assetId, "notice", `Status changed to ${newStatus}.`));
}

// Soft delete: sets deleted_at, the row stays for history and audit. Meant for assets entered by
// mistake — an asset that has left the business should be Retired / Disposed instead.
export async function deleteAsset(assetId: string) {
  const { supabase, personId, actorLabel } = await requirePermission("it.assets.delete");

  const { data: current } = await supabase
    .schema("it")
    .from("assets")
    .select("asset_tag, asset_name, status")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) redirect(detailUrl(assetId, "error", "This asset no longer exists."));
  if (SYSTEM_MANAGED_STATUSES.includes(current.status)) {
    redirect(
      detailUrl(assetId, "error", `An asset that is ${current.status} can't be deleted.`),
    );
  }

  const { data: deleted, error } = await supabase
    .schema("it")
    .from("assets")
    .update({ deleted_at: new Date().toISOString(), updated_by: personId })
    .eq("id", assetId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) redirect(detailUrl(assetId, "error", error.message));
  if (!deleted) redirect(detailUrl(assetId, "error", "You don't have permission to delete this asset."));

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "DELETED",
    details: `Deleted asset ${current.asset_tag} (${current.asset_name})`,
  });

  revalidatePath("/it/inventory");
  redirect(`/it/inventory?deleted=${encodeURIComponent(current.asset_tag)}`);
}

// INV-04 — record that the holder gave the asset back. Goes through it.return_asset(), which
// closes the assignment and sets the asset's new status in one transaction, so the two can't
// drift. Also meant for Javaria's offboarding "Asset Return Form" (07-it-inventory-plan.md §2.1).
export async function returnAsset(assetId: string, formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission("it.assets.assign");

  const newStatus = text(formData, "new_status") as ReturnStatus;
  const returnDate = optionalText(formData, "return_date");
  const returnedCondition = optionalText(formData, "returned_condition");
  const remarks = optionalText(formData, "remarks");
  if (!RETURN_STATUSES.includes(newStatus)) {
    redirect(detailUrl(assetId, "error", "Choose what happens to the asset after the return."));
  }

  const [{ data: asset }, { data: assignment }] = await Promise.all([
    supabase
      .schema("it")
      .from("assets")
      .select("asset_tag")
      .eq("id", assetId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .schema("it")
      .from("asset_assignments")
      .select("id, assigned_date")
      .eq("asset_id", assetId)
      .is("return_date", null)
      .maybeSingle(),
  ]);
  if (!asset) redirect(detailUrl(assetId, "error", "This asset no longer exists."));
  if (!assignment) redirect(detailUrl(assetId, "error", "This asset isn't currently assigned."));
  if (returnDate && returnDate < assignment.assigned_date) {
    redirect(detailUrl(assetId, "error", "The return date can't be before the date it was assigned."));
  }

  const { error } = await supabase.schema("it").rpc("return_asset", {
    p_assignment_id: assignment.id,
    p_returned_condition: returnedCondition,
    p_remarks: remarks,
    p_new_status: newStatus,
    ...(returnDate ? { p_return_date: returnDate } : {}),
  });
  if (error) redirect(detailUrl(assetId, "error", error.message));

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details:
      `Returned asset ${asset.asset_tag}; now ${newStatus}` +
      (returnedCondition ? ` (condition: ${returnedCondition})` : ""),
  });

  revalidatePath("/it/inventory");
  revalidatePath(`/it/inventory/${assetId}`);
  revalidatePath("/it/my-assets");
  redirect(detailUrl(assetId, "notice", `Return recorded. ${asset.asset_tag} is now ${newStatus}.`));
}
