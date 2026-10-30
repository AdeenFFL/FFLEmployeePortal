"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseMoney } from "@/lib/it/procurement";

// PRC-02 Product Master (09-it-procurement-plan.md Phase 1). RLS on it.products requires
// it.products.update for writes (javaria_it_0009); checked here too. Audit-logged by trigger.

const PATH = "/it/procurement/products";

function go(kind: "error" | "notice", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function productFields(formData: FormData) {
  const purchase = parseMoney(formData.get("purchasePrice"));
  const current = parseMoney(formData.get("currentPrice"));
  if (purchase === undefined || current === undefined) {
    go("error", "Prices must be positive numbers (e.g. 125000 or 125,000.50).");
  }
  return {
    product_name: text(formData, "productName"),
    category: text(formData, "category") || null,
    unit: text(formData, "unit") || "Each",
    purchase_price: purchase,
    current_price: current,
    description: text(formData, "description") || null,
    // Set = fixed-asset product (receiving registers assets); empty = consumable / service.
    asset_type_id: text(formData, "assetTypeId") || null,
  };
}

function friendly(error: { code?: string; message: string }, name: string) {
  if (error.code === "23505") return `A product called "${name}" already exists.`;
  if (error.code === "23503") return "That asset type no longer exists — pick another.";
  return error.message;
}

export async function createProduct(formData: FormData) {
  const { supabase } = await requirePermission("it.products.update");
  const fields = productFields(formData);
  if (!fields.product_name) go("error", "Product name is required.");

  const { error } = await supabase.schema("it").from("products").insert(fields);
  if (error) go("error", friendly(error, fields.product_name));

  revalidatePath(PATH);
  go("notice", `Product "${fields.product_name}" added.`);
}

export async function updateProduct(id: string, formData: FormData) {
  const { supabase } = await requirePermission("it.products.update");
  const fields = productFields(formData);
  if (!fields.product_name) go("error", "Product name is required.");

  const { error } = await supabase.schema("it").from("products").update(fields).eq("id", id);
  if (error) go("error", friendly(error, fields.product_name));

  revalidatePath(PATH);
  go("notice", `Product "${fields.product_name}" saved.`);
}

// Products are never deleted (demands and stock movements keep pointing at them).
export async function setProductActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.products.update");

  const { error } = await supabase
    .schema("it")
    .from("products")
    .update({ is_active: active })
    .eq("id", id);
  if (error) go("error", error.message);

  revalidatePath(PATH);
  go("notice", active ? "Product reactivated." : "Product deactivated — it can't be picked for new demands.");
}
