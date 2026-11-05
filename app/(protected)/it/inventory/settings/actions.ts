"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAuditEvent } from "@/lib/audit/log";
import type {
  AssetClassification,
  AssetValueTypeName,
  DepreciationMethod,
} from "@/types/database";

const PATH = "/it/inventory/settings";
const PERMISSION = "it.inventory_settings.update";

const CLASSIFICATIONS: AssetClassification[] = ["Fixed", "Consumable"];
const VALUE_TYPE_NAMES: AssetValueTypeName[] = ["New", "Old"];
const DEPRECIATION_METHODS: DepreciationMethod[] = ["Straight Line", "Reducing Balance"];

// Every action ends on the settings page with a ?notice= / ?error= banner (and closes the drawer)
// instead of throwing to the error boundary.
function go(tab: "types" | "values", kind: "notice" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}${tab === "values" ? "#values" : ""}`);
}

function parseClassification(value: FormDataEntryValue | null): AssetClassification {
  const classification = String(value ?? "") as AssetClassification;
  if (!CLASSIFICATIONS.includes(classification)) go("types", "error", "Choose Fixed or Consumable.");
  return classification;
}

// audit_log's insert policy is currently admin-only (0004), so for non-admin IT staff this
// logs nothing — logAuditEvent swallows the RLS failure rather than blocking the mutation.
// Flagged for the core team in 07-it-inventory-plan.md §8.

export async function createAssetType(formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission(PERMISSION);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const classification = parseClassification(formData.get("classification"));
  const isActive = formData.get("is_active") !== null;
  if (!name) go("types", "error", "Name is required.");

  const { error } = await supabase
    .schema("it")
    .from("asset_types")
    .insert({ name, classification, description, is_active: isActive, created_by: personId, updated_by: personId });
  if (error?.code === "23505") go("types", "error", `An asset type named "${name}" already exists.`);
  if (error) go("types", "error", error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "CREATED",
    details: `Created asset type "${name}" (${classification})`,
  });
  revalidatePath(PATH);
  go("types", "notice", `Asset type "${name}" added.`);
}

export async function updateAssetType(assetTypeId: string, formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission(PERMISSION);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const classification = parseClassification(formData.get("classification"));
  const isActive = formData.get("is_active") !== null;
  if (!name) go("types", "error", "Name is required.");

  const { error } = await supabase
    .schema("it")
    .from("asset_types")
    .update({ name, classification, description, is_active: isActive, updated_by: personId })
    .eq("id", assetTypeId);
  if (error?.code === "23505") go("types", "error", `An asset type named "${name}" already exists.`);
  if (error) go("types", "error", error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details: `Updated asset type "${name}" (${classification})`,
  });
  revalidatePath(PATH);
  go("types", "notice", `Asset type "${name}" saved.`);
}

export async function toggleAssetTypeActive(assetTypeId: string, isActive: boolean) {
  const { supabase, personId, actorLabel } = await requirePermission(PERMISSION);

  const { data, error } = await supabase
    .schema("it")
    .from("asset_types")
    .update({ is_active: isActive, updated_by: personId })
    .eq("id", assetTypeId)
    .select("name")
    .single();
  if (error) go("types", "error", error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details: `${isActive ? "Activated" : "Deactivated"} asset type "${data.name}"`,
  });
  revalidatePath(PATH);
  go("types", "notice", `"${data.name}" ${isActive ? "activated" : "deactivated — it stays on existing assets but can't be picked"}.`);
}

export async function deleteAssetType(assetTypeId: string) {
  const { supabase, personId, actorLabel } = await requirePermission(PERMISSION);

  const { data, error } = await supabase
    .schema("it")
    .from("asset_types")
    .delete()
    .eq("id", assetTypeId)
    .select("name")
    .single();
  // 23503 = foreign_key_violation: assets (or Javeria's products) still reference this type.
  if (error?.code === "23503") {
    go("types", "error", "This asset type is in use. Deactivate it instead of deleting it.");
  }
  if (error) go("types", "error", error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "DELETED",
    details: `Deleted asset type "${data.name}"`,
  });
  revalidatePath(PATH);
  go("types", "notice", `Asset type "${data.name}" deleted.`);
}

// Value types are a fixed pair (New / Old, enforced by a check constraint), so there's no
// create/delete — each one is configured in place. Upsert on `name` covers both the first save
// and later edits.
export async function saveAssetValueType(name: AssetValueTypeName, formData: FormData) {
  const { supabase, personId, actorLabel } = await requirePermission(PERMISSION);
  if (!VALUE_TYPE_NAMES.includes(name)) go("values", "error", "Unknown value type.");

  const depreciationPercentage = Number(formData.get("depreciation_percentage"));
  if (!Number.isFinite(depreciationPercentage) || depreciationPercentage < 0 || depreciationPercentage > 100) {
    go("values", "error", "Depreciation % must be between 0 and 100.");
  }

  const depreciationMethod = String(formData.get("depreciation_method") ?? "") as DepreciationMethod;
  if (!DEPRECIATION_METHODS.includes(depreciationMethod)) {
    go("values", "error", "Choose a depreciation method.");
  }

  const usefulLifeRaw = String(formData.get("useful_life_years") ?? "").trim();
  const usefulLifeYears = usefulLifeRaw ? Number(usefulLifeRaw) : null;
  if (usefulLifeYears !== null && (!Number.isInteger(usefulLifeYears) || usefulLifeYears <= 0)) {
    go("values", "error", "Useful life must be a whole number of years greater than 0.");
  }

  const description = String(formData.get("description") ?? "").trim() || null;

  const { error } = await supabase
    .schema("it")
    .from("asset_value_types")
    .upsert(
      {
        name,
        depreciation_percentage: depreciationPercentage,
        depreciation_method: depreciationMethod,
        useful_life_years: usefulLifeYears,
        description,
        updated_by: personId,
      },
      { onConflict: "name" },
    );
  if (error) go("values", "error", error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "it",
    action: "MODIFIED",
    details: `Set value type "${name}": ${depreciationPercentage}% ${depreciationMethod}${
      usefulLifeYears ? `, ${usefulLifeYears} yr useful life` : ""
    }`,
  });
  revalidatePath(PATH);
  go("values", "notice", `${name} asset rules saved.`);
}
