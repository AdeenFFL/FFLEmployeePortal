"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

const PATH = "/hr/admin/categories";

export async function createCategory(formData: FormData) {
  const { supabase } = await requirePermission("hr.manage_categories");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) throw new Error("Name is required.");

  const { error } = await supabase.schema("hr").from("ticket_categories").insert({ name, description });
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function toggleCategoryActive(categoryId: string, isActive: boolean) {
  const { supabase } = await requirePermission("hr.manage_categories");

  const { error } = await supabase
    .schema("hr")
    .from("ticket_categories")
    .update({ is_active: isActive })
    .eq("id", categoryId);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function deleteCategory(categoryId: string) {
  const { supabase } = await requirePermission("hr.manage_categories");

  const { error } = await supabase.schema("hr").from("ticket_categories").delete().eq("id", categoryId);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function addCategoryAssignee(categoryId: string, formData: FormData) {
  const { supabase } = await requirePermission("hr.manage_categories");

  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("Email is required.");

  const { data: account } = await supabase
    .from("user_accounts")
    .select("person_id")
    .eq("email", email)
    .maybeSingle();
  if (!account) throw new Error(`No account found for ${email}.`);

  const { error } = await supabase
    .schema("hr")
    .from("ticket_category_assignees")
    .insert({ category_id: categoryId, person_id: account.person_id });
  if (error && error.code !== "23505") throw new Error(error.message);

  revalidatePath(PATH);
}

export async function removeCategoryAssignee(categoryId: string, personId: string) {
  const { supabase } = await requirePermission("hr.manage_categories");

  const { error } = await supabase
    .schema("hr")
    .from("ticket_category_assignees")
    .delete()
    .eq("category_id", categoryId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}
