"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { queueItEmails } from "@/lib/it/notifications";
import { parseMoney } from "@/lib/it/procurement";
import { documentFiles, documentFilesError, uploadDocumentFile } from "@/lib/it/procurement-files";

// Phase 5 — invoices (javaria_it_0014_invoices.sql). One invoice per delivery. The database
// functions enforce the workflow (verification, approval, gate-pass rule); these actions collect
// input, upload files and turn errors into ?error= messages on the demand page.

const LIST = "/it/procurement/demands";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function done(path: string, message: string): never {
  revalidatePath(LIST);
  revalidatePath(path);
  revalidatePath("/it/procurement/approvals");
  queueItEmails();
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function invoiceFields(formData: FormData, path: string) {
  const invoiceNumber = text(formData, "invoiceNumber");
  const invoiceDate = text(formData, "invoiceDate");
  const quantity = Number(text(formData, "quantity"));
  const amount = parseMoney(formData.get("amount"));
  const tax = parseMoney(formData.get("tax"));
  if (!invoiceNumber) fail(path, "Enter the vendor's invoice number.");
  if (!invoiceDate) fail(path, "Enter the invoice date.");
  if (!Number.isInteger(quantity) || quantity < 0) fail(path, "Enter the quantity billed.");
  if (amount === undefined || amount === null) fail(path, "Enter the invoice total (e.g. 125000 or 125,000.50).");
  if (tax === undefined) fail(path, "Tax must be a positive amount, or empty.");
  return { invoiceNumber, invoiceDate, quantity, amount, tax: tax ?? 0, notes: text(formData, "notes") || null };
}

async function attachInvoiceFiles(
  supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"],
  demandId: string,
  invoiceId: string,
  files: File[],
  docType: "Invoice" | "Other",
) {
  let failed = 0;
  for (const file of files) {
    const storagePath = await uploadDocumentFile(supabase, demandId, file);
    if (!storagePath) {
      failed++;
      continue;
    }
    const { error } = await supabase.schema("it").rpc("add_invoice_document", {
      p_invoice_id: invoiceId,
      p_doc_type: docType,
      p_storage_path: storagePath,
      p_file_name: file.name,
      p_content_type: file.type || null,
      p_size_bytes: file.size,
    });
    if (error) failed++;
  }
  return failed;
}

// BRD §5.5.10–5.5.13 — log the vendor's invoice for one delivery; checked automatically.
export async function logInvoice(demandId: string, receivingId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const f = invoiceFields(formData, path);
  const files = documentFiles(formData, "invoiceFiles");
  const fileError = documentFilesError(files);
  if (fileError) fail(path, fileError);

  const { data: invoiceId, error } = await supabase.schema("it").rpc("log_invoice", {
    p_receiving_id: receivingId,
    p_invoice_number: f.invoiceNumber,
    p_invoice_date: f.invoiceDate,
    p_quantity: f.quantity,
    p_amount: f.amount,
    p_tax: f.tax,
    p_notes: f.notes,
  });
  if (error || !invoiceId) {
    fail(path, error?.code === "23505" ? "This vendor already has an invoice with that number." : (error?.message ?? "Could not log the invoice."));
  }

  const failed = await attachInvoiceFiles(supabase, demandId, invoiceId, files, "Invoice");
  done(
    path,
    failed > 0 ? `Invoice logged, but ${failed} file(s) could not be uploaded.` : "Invoice logged and checked against the delivery.",
  );
}

export async function updateInvoice(demandId: string, invoiceId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const f = invoiceFields(formData, path);
  const { error } = await supabase.schema("it").rpc("update_invoice", {
    p_invoice_id: invoiceId,
    p_invoice_number: f.invoiceNumber,
    p_invoice_date: f.invoiceDate,
    p_quantity: f.quantity,
    p_amount: f.amount,
    p_tax: f.tax,
    p_notes: f.notes,
  });
  if (error) fail(path, error.code === "23505" ? "This vendor already has an invoice with that number." : error.message);

  done(path, "Invoice updated and re-checked.");
}

export async function uploadInvoiceFiles(demandId: string, invoiceId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const docType = text(formData, "docType") === "Other" ? "Other" : "Invoice";
  const files = documentFiles(formData, "files");
  if (files.length === 0) fail(path, "Choose a file to upload.");
  const fileError = documentFilesError(files);
  if (fileError) fail(path, fileError);

  const failed = await attachInvoiceFiles(supabase, demandId, invoiceId, files, docType);
  if (failed === files.length) fail(path, "The file(s) could not be uploaded.");
  done(path, failed > 0 ? `${files.length - failed} uploaded, ${failed} failed.` : "Uploaded.");
}

export async function clearInvoiceFlag(demandId: string, invoiceId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const note = text(formData, "note");
  if (!note) fail(path, "Please explain why the difference is acceptable.");

  const { error } = await supabase.schema("it").rpc("clear_invoice_flag", { p_invoice_id: invoiceId, p_note: note });
  if (error) fail(path, error.message);

  done(path, "Mismatch cleared — the invoice can go for approval.");
}

export async function submitInvoice(demandId: string, invoiceId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const { error } = await supabase.schema("it").rpc("submit_invoice_for_approval", { p_invoice_id: invoiceId });
  if (error) fail(path, error.message);

  done(path, "Invoice sent to the department head for approval.");
}

// BRD §5.5.15 — approve, or send back with the reason.
export async function decideInvoice(demandId: string, invoiceId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.approve");

  const decision = text(formData, "decision") === "Revise" ? "Revise" : "Approved";
  const comments = text(formData, "comments") || null;
  if (decision === "Revise" && !comments) fail(path, "Please say what needs to be revised.");

  const { error } = await supabase.schema("it").rpc("decide_invoice", {
    p_invoice_id: invoiceId,
    p_decision: decision,
    p_comments: comments,
  });
  if (error) fail(path, error.message);

  done(path, decision === "Approved" ? "Invoice approved." : "Invoice sent back for revision.");
}

// BRD §5.5.16 — package to Finance (needs gate pass proof + the invoice file).
export async function sendInvoiceToFinance(demandId: string, invoiceId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.invoices.update");

  const { error } = await supabase.schema("it").rpc("send_invoice_to_finance", { p_invoice_id: invoiceId });
  if (error) fail(path, error.message);

  done(path, "Invoice package sent to Finance.");
}
