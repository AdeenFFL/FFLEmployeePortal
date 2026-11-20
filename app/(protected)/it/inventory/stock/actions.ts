"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import type { ItStockMovementType } from "@/types/database";

// INV-07 Stock (javaria_it_0022). it.record_stock_movement checks it.stock.update, that the
// product is a consumable, and that stock never goes below 0; this only collects the form.

const PATH = "/it/inventory/stock";
const TYPES: ItStockMovementType[] = ["Opening", "Received", "Issued", "Adjustment"];

const LABEL: Record<ItStockMovementType, string> = {
  Opening: "Opening balance recorded",
  Received: "Stock added",
  Issued: "Stock issued",
  Adjustment: "Stock adjusted",
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function recordStockMovement(formData: FormData) {
  const { supabase } = await requirePermission("it.stock.update");
  const fail = (message: string): never => redirect(`${PATH}?error=${encodeURIComponent(message)}`);

  const type = text(formData, "type") as ItStockMovementType;
  if (!TYPES.includes(type)) fail("Choose what kind of movement this is.");
  const productId = text(formData, "productId");
  const siteId = text(formData, "siteId");
  if (!productId || !siteId) fail("Choose the product and the site.");
  const quantity = Number(text(formData, "quantity"));
  if (!Number.isInteger(quantity) || quantity <= 0) fail("Enter a whole quantity greater than 0.");
  // Adjustment: the form sends the direction separately so the number stays positive.
  const signed = type === "Adjustment" && text(formData, "direction") === "down" ? -quantity : quantity;

  const { error } = await supabase.schema("it").rpc("record_stock_movement", {
    p_product_id: productId,
    p_site_id: siteId,
    p_type: type,
    p_quantity: signed,
    p_issued_to: type === "Issued" ? text(formData, "personId") || null : null,
    p_reason: text(formData, "reason") || null,
    p_date: text(formData, "movementDate") || null,
  });
  if (error) fail(error.message);

  revalidatePath(PATH);
  redirect(`${PATH}?notice=${encodeURIComponent(`${LABEL[type]}.`)}`);
}
