"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";

// PRC-01 Vendor Master (09-it-procurement-plan.md Phase 1). RLS on it.vendors requires
// it.vendors.update for writes (javaria_it_0009); checked here too. Every change is audit-logged
// by a database trigger.

const PATH = "/it/procurement/vendors";

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function vendorFields(formData: FormData) {
  const email = text(formData, "email");
  return {
    vendor_name: text(formData, "vendorName"),
    contact_person: text(formData, "contactPerson") || null,
    contact_no: text(formData, "contactNo") || null,
    email: email || null,
    address: text(formData, "address") || null,
    tax_number: text(formData, "taxNumber") || null,
    notes: text(formData, "notes") || null,
  };
}

function friendly(error: { code?: string; message: string }, name: string) {
  if (error.code === "23505") return `A vendor called "${name}" already exists.`;
  if (error.code === "23514") return "Please check the email address.";
  return error.message;
}

export async function createVendor(formData: FormData) {
  const { supabase } = await requirePermission("it.vendors.update");
  const back = `${PATH}/new`;
  const fields = vendorFields(formData);
  if (!fields.vendor_name) go(back, "error", "Vendor name is required.");

  const { data, error } = await supabase.schema("it").from("vendors").insert(fields).select("id").single();
  if (error || !data) go(back, "error", error ? friendly(error, fields.vendor_name) : "Vendor was not saved.");

  revalidatePath(PATH);
  go(`${PATH}/${data.id}`, "notice", `Vendor "${fields.vendor_name}" added.`);
}

export async function updateVendor(id: string, formData: FormData) {
  const { supabase } = await requirePermission("it.vendors.update");
  const back = `${PATH}/${id}`;
  const fields = vendorFields(formData);
  if (!fields.vendor_name) go(back, "error", "Vendor name is required.");

  const { error } = await supabase.schema("it").from("vendors").update(fields).eq("id", id);
  if (error) go(back, "error", friendly(error, fields.vendor_name));

  revalidatePath(PATH);
  revalidatePath(back);
  go(back, "notice", "Changes saved.");
}

// Vendors are never deleted (demands, assets and repairs keep pointing at them).
export async function setVendorActive(id: string, active: boolean) {
  const { supabase } = await requirePermission("it.vendors.update");

  const { error } = await supabase
    .schema("it")
    .from("vendors")
    .update({ is_active: active })
    .eq("id", id);
  const back = `${PATH}/${id}`;
  if (error) go(back, "error", error.message);

  revalidatePath(PATH);
  revalidatePath(back);
  go(back, "notice", active ? "Vendor reactivated." : "Vendor deactivated — it can't be picked for new demands.");
}
