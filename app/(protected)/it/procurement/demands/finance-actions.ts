"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { queueItEmails } from "@/lib/it/notifications";
import { parseMoney, PAYMENT_METHODS } from "@/lib/it/procurement";
import { documentFiles, documentFilesError, uploadDocumentFile } from "@/lib/it/procurement-files";
import type { ItPaymentMethod } from "@/types/database";

// Phase 6 — Finance (javaria_it_0015_payments.sql). All gated by it.payments.update; the
// database functions enforce the rules (amount ≤ unpaid, status, closing the demand).
// `back` lets the Finance inbox and the demand page share these actions.

const LIST = "/it/procurement/demands";
const FINANCE = "/it/procurement/finance";

function backPath(demandId: string, formData?: FormData) {
  return formData?.get("back") === "finance" ? FINANCE : `${LIST}/${demandId}`;
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function done(path: string, demandId: string, message: string): never {
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${demandId}`);
  revalidatePath(FINANCE);
  queueItEmails();
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function confirmInvoicePackage(demandId: string, invoiceId: string, formData: FormData) {
  const path = backPath(demandId, formData);
  const { supabase } = await requirePermission("it.payments.update");

  const { error } = await supabase.schema("it").rpc("confirm_invoice_package", {
    p_invoice_id: invoiceId,
    p_note: text(formData, "note") || null,
  });
  if (error) fail(path, error.message);

  done(path, demandId, "Invoice package confirmed.");
}

export async function returnInvoicePackage(demandId: string, invoiceId: string, formData: FormData) {
  const path = backPath(demandId, formData);
  const { supabase } = await requirePermission("it.payments.update");

  const reason = text(formData, "reason");
  if (!reason) fail(path, "Please say what procurement needs to fix.");

  const { error } = await supabase.schema("it").rpc("return_invoice_package", {
    p_invoice_id: invoiceId,
    p_reason: reason,
  });
  if (error) fail(path, error.message);

  done(path, demandId, "Package returned to procurement.");
}

// BRD §5.5.18–5.5.19 — record a payment, optionally email the reference to the vendor and
// attach a payment proof.
export async function recordPayment(demandId: string, invoiceId: string, formData: FormData) {
  const path = backPath(demandId, formData);
  const { supabase } = await requirePermission("it.payments.update");

  const reference = text(formData, "reference");
  const paymentDate = text(formData, "paymentDate");
  const amount = parseMoney(formData.get("amount"));
  const method = text(formData, "method") as ItPaymentMethod;
  if (!reference) fail(path, "Enter the payment reference (cheque / transaction no.).");
  if (!paymentDate) fail(path, "Enter the payment date.");
  if (amount === undefined || amount === null || amount <= 0) fail(path, "Enter the amount paid.");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) fail(path, "Choose the payment method.");
  const files = documentFiles(formData, "proofFiles");
  const fileError = documentFilesError(files);
  if (fileError) fail(path, fileError);

  const { data: paymentId, error } = await supabase.schema("it").rpc("record_payment", {
    p_invoice_id: invoiceId,
    p_reference: reference,
    p_payment_date: paymentDate,
    p_amount: amount,
    p_method: method,
    p_remarks: text(formData, "remarks") || null,
    p_notify_vendor: formData.get("notifyVendor") === "on",
  });
  if (error || !paymentId) fail(path, error?.message ?? "Could not record the payment.");

  let failed = 0;
  for (const file of files) {
    const storagePath = await uploadDocumentFile(supabase, demandId, file);
    if (!storagePath) {
      failed++;
      continue;
    }
    const { error: docError } = await supabase.schema("it").rpc("add_payment_document", {
      p_payment_id: paymentId,
      p_storage_path: storagePath,
      p_file_name: file.name,
      p_content_type: file.type || null,
      p_size_bytes: file.size,
    });
    if (docError) failed++;
  }

  done(
    path,
    demandId,
    failed > 0 ? `Payment recorded, but ${failed} proof file(s) could not be uploaded.` : "Payment recorded.",
  );
}

export async function sendPaymentReference(demandId: string, paymentId: string, formData: FormData) {
  const path = backPath(demandId, formData);
  const { supabase } = await requirePermission("it.payments.update");

  const { error } = await supabase.schema("it").rpc("send_payment_reference", { p_payment_id: paymentId });
  if (error) fail(path, error.message);

  done(path, demandId, "Payment reference emailed to the vendor.");
}
