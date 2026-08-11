"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";

function readDependentFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    relationship: String(formData.get("relationship") ?? "").trim(),
    cnic_or_bform: String(formData.get("cnic_or_bform") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
  };
}

export async function addOrUpdateDependent(formData: FormData) {
  const { supabase, userId } = await requireActiveUser();
  const fields = readDependentFields(formData);
  if (!fields.name || !fields.relationship) {
    throw new Error("Name and Relationship are required.");
  }

  const dependentId = String(formData.get("dependent_id") ?? "").trim() || null;
  const file = formData.get("supporting_document");
  let supportingDocumentPath: string | undefined;

  if (file instanceof File && file.size > 0) {
    const path = `${userId}/dependents/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("employee-documents")
      .upload(path, file);
    if (uploadError) throw new Error(uploadError.message);
    supportingDocumentPath = path;
  }

  if (dependentId) {
    const { data: existing } = await supabase
      .from("dependents")
      .select("id, profile_id")
      .eq("id", dependentId)
      .maybeSingle();
    if (!existing || existing.profile_id !== userId) throw new Error("Not found.");

    const { error } = await supabase
      .from("dependents")
      .update({
        ...fields,
        ...(supportingDocumentPath ? { supporting_document_path: supportingDocumentPath } : {}),
      })
      .eq("id", dependentId);
    // Column-level GRANT (migration 0003) already excludes `status` from what this UPDATE can
    // touch, even though `fields` never contains it anyway — the grant is the actual backstop.
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("dependents").insert({
      profile_id: userId,
      ...fields,
      supporting_document_path: supportingDocumentPath ?? null,
      // status omitted — column DEFAULT 'Pending HR Approval' applies.
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/profile/insurance");
}

export async function removeDependent(dependentId: string) {
  const { supabase, userId } = await requireActiveUser();

  const { data: dep } = await supabase
    .from("dependents")
    .select("id, profile_id, supporting_document_path")
    .eq("id", dependentId)
    .maybeSingle();
  if (!dep || dep.profile_id !== userId) throw new Error("Not found.");

  if (dep.supporting_document_path) {
    await supabase.storage.from("employee-documents").remove([dep.supporting_document_path]);
  }
  const { error } = await supabase.from("dependents").delete().eq("id", dependentId);
  if (error) throw new Error(error.message);

  revalidatePath("/profile/insurance");
}
