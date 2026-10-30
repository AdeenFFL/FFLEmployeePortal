import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_TOTAL_DOCUMENT_BYTES,
} from "@/lib/it/procurement";

// Shared by the procurement Server Actions that store files in the private it-documents bucket
// (javaria_it_0012 / 0014). Files live at {demand_id}/{random}-{name}; the database row is
// registered afterwards by a security-definer function.

export function documentFiles(formData: FormData, key: string) {
  return formData.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
}

// null when fine, otherwise the message to show.
export function documentFilesError(files: File[]) {
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD) return `Attach at most ${MAX_DOCUMENTS_PER_UPLOAD} files at a time.`;
  if (files.some((f) => f.size > MAX_DOCUMENT_BYTES)) return "Each file must be 5 MB or smaller.";
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_DOCUMENT_BYTES) return "Files must be 8 MB or smaller in total.";
  if (files.some((f) => f.type && !DOCUMENT_MIME_TYPES.includes(f.type))) {
    return "Only photos (JPG, PNG, WEBP, HEIC) or PDF files can be attached.";
  }
  return null;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100) || "file";
}

// Uploads one file into the demand's folder; returns its storage path, or null on failure.
export async function uploadDocumentFile(supabase: SupabaseClient<Database>, demandId: string, file: File) {
  const storagePath = `${demandId}/${randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  return error ? null : storagePath;
}
