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

export async function uploadEducationalDocument(formData: FormData) {
  const { supabase, userId } = await requireActiveUser();

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A file is required.");
  }
  const documentName = String(formData.get("document_name") ?? "").trim() || file.name;

  const path = `${userId}/education/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("employee-documents")
    .upload(path, file);
  if (uploadError) throw new Error(uploadError.message);

  const { error: insertError } = await supabase.from("educational_documents").insert({
    profile_id: userId,
    document_name: documentName,
    storage_path: path,
  });
  if (insertError) throw new Error(insertError.message);

  revalidatePath("/profile");
}

export async function deleteEducationalDocument(documentId: string) {
  const { supabase, userId } = await requireActiveUser();

  const { data: doc } = await supabase
    .from("educational_documents")
    .select("id, profile_id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.profile_id !== userId) throw new Error("Not found.");

  await supabase.storage.from("employee-documents").remove([doc.storage_path]);
  const { error } = await supabase.from("educational_documents").delete().eq("id", documentId);
  if (error) throw new Error(error.message);

  revalidatePath("/profile");
}
