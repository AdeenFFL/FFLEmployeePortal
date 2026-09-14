"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/require-user";

export async function updateOwnBiodata(formData: FormData) {
  const { supabase } = await requireActiveUser();

  const { error } = await supabase.rpc("update_own_biodata", {
    p_display_name: String(formData.get("display_name") ?? "").trim() || null,
    p_cnic: String(formData.get("cnic") ?? "").trim() || null,
    p_date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    p_address: String(formData.get("address") ?? "").trim() || null,
    p_emergency_contact_name:
      String(formData.get("emergency_contact_name") ?? "").trim() || null,
    p_emergency_contact_phone:
      String(formData.get("emergency_contact_phone") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/profile");
  // Drops the ?edit=personal param so the page renders back in read-only mode after saving.
  redirect("/profile");
}

export async function changeOwnPassword(formData: FormData) {
  const { supabase } = await requireActiveUser();

  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (newPassword !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);

  revalidatePath("/profile");
}
