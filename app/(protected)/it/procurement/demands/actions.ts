"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireActiveUser } from "@/lib/auth/require-user";
import { queueItEmails } from "@/lib/it/notifications";
import {
  DEMAND_CATEGORIES,
  DOCUMENT_BUCKET,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_TOTAL_DOCUMENT_BYTES,
  parseMoney,
  RECEIVING_CONDITIONS,
} from "@/lib/it/procurement";
import type {
  ItDemand,
  ItDemandCategory,
  ItDemandDecision,
  ItDocumentType,
  ItReceivingCondition,
} from "@/types/database";

const DECISIONS: ItDemandDecision[] = ["Approved", "Partially Approved", "Rejected"];
const DOCUMENT_TYPES: ItDocumentType[] = ["Gate Pass", "Delivery Challan", "Quotation", "Photo", "Other"];

// PRC-03/04/05 (09-it-procurement-plan.md Phase 2). The database decides what's allowed:
// RLS on it.demands + it.demands_before_update() (javaria_it_0010_demands.sql). These actions
// only collect input and turn errors into ?error= messages.

const LIST = "/it/procurement/demands";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function done(path: string, message: string): never {
  revalidatePath(LIST);
  revalidatePath(path);
  queueItEmails();
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

// A fixed-asset product (linked to an asset type) is bought and registered as an asset — it
// can't take the consumable "issue from stock" path.
const FIXED_ASSET_NOT_CONSUMABLE =
  "This product is a fixed asset (it has an asset type), so it can't be a Consumable — choose General purchase, Repair, Maintenance or Fix.";

async function isFixedAssetProduct(supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"], productId: string) {
  const { data } = await supabase.schema("it").from("products").select("asset_type_id").eq("id", productId).maybeSingle();
  return Boolean(data?.asset_type_id);
}

function quantity(formData: FormData, path: string) {
  const n = Number(text(formData, "quantity"));
  if (!Number.isInteger(n) || n < 1 || n > 100000) fail(path, "Quantity must be a whole number from 1 to 100,000.");
  return n;
}

// PRC-04 — status, category, vendor and price are set by the database, never by the form.
export async function createDemand(formData: FormData) {
  const NEW = `${LIST}/new`;
  const { supabase, personId } = await requirePermission("it.demands.create");

  const productId = text(formData, "productId");
  const departmentId = text(formData, "departmentId");
  const justification = text(formData, "justification");
  const category = text(formData, "category") as ItDemandCategory;
  if (!productId) fail(NEW, "Please choose a product.");
  if (!DEMAND_CATEGORIES.some((c) => c.value === category)) fail(NEW, "Please choose the demand category.");
  if (!departmentId) fail(NEW, "Please choose the department.");
  if (!justification) fail(NEW, "Please explain why this is needed.");
  if (category === "Consumable" && (await isFixedAssetProduct(supabase, productId))) fail(NEW, FIXED_ASSET_NOT_CONSUMABLE);

  const { data: demand, error } = await supabase
    .schema("it")
    .from("demands")
    .insert({
      product_id: productId,
      requested_by_person_id: personId,
      department_id: departmentId,
      site_id: text(formData, "siteId") || undefined,
      quantity: quantity(formData, NEW),
      justification,
      demand_category: category,
    })
    .select("id, demand_number")
    .single();
  if (error || !demand) fail(NEW, error?.message ?? "Could not raise the demand.");

  // The database routes non-consumables to the department head straight away (javaria_it_0017,
  // an AFTER INSERT trigger — so re-read: RETURNING shows the row before that ran).
  const { data: after } = await supabase.schema("it").from("demands").select("status").eq("id", demand.id).maybeSingle();
  done(
    `${LIST}/${demand.id}`,
    after?.status === "Pending Approval"
      ? `Demand ${demand.demand_number} raised and sent to the department head for approval.`
      : `Demand ${demand.demand_number} raised. Procurement has been notified.`,
  );
}

// Requester or procurement staff, while Open.
export async function editDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requireActiveUser();

  const justification = text(formData, "justification");
  if (!justification) fail(path, "Justification can't be empty.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({
      product_id: text(formData, "productId"),
      department_id: text(formData, "departmentId"),
      quantity: quantity(formData, path),
      justification,
    })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand updated.");
}

// BRD §5.5.2 — Open → Categorized (or a category change while still Categorized).
export async function categorizeDemand(demandId: string, status: ItDemand["status"], formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const category = text(formData, "category") as ItDemandCategory;
  if (!DEMAND_CATEGORIES.some((c) => c.value === category)) fail(path, "Please choose a category.");
  if (category === "Consumable") {
    const { data: d } = await supabase.schema("it").from("demands").select("product_id").eq("id", demandId).maybeSingle();
    if (d && (await isFixedAssetProduct(supabase, d.product_id))) fail(path, FIXED_ASSET_NOT_CONSUMABLE);
  }

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update(status === "Open" ? { demand_category: category, status: "Categorized" } : { demand_category: category })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, status === "Open" ? "Demand categorised." : "Category changed.");
}

export async function cancelDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requireActiveUser();

  const reason = text(formData, "reason");
  if (!reason) fail(path, "Please give a reason for cancelling.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({ status: "Cancelled", cancellation_reason: reason })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand cancelled.");
}

// BRD §5.5.3 consumable path. Interim until Talha's recordStockMovement() ships (plan §2):
// the stock issue is recorded as a note.
export async function markStockUpdated(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const note = text(formData, "stockNote");
  if (!note) fail(path, "Please note what was issued from stock.");

  const { error } = await supabase
    .schema("it")
    .from("demands")
    .update({ status: "Stock Updated", stock_note: note })
    .eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Stock entry recorded.");
}

export async function closeDemand(demandId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const { error } = await supabase.schema("it").from("demands").update({ status: "Closed" }).eq("id", demandId);
  if (error) fail(path, error.message);

  done(path, "Demand closed.");
}

// BRD §5.5.4 — Categorized → Pending Approval; the database notifies the department's approvers.
export async function submitForApproval(demandId: string) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const { error } = await supabase.schema("it").rpc("submit_demand_for_approval", { p_demand_id: demandId });
  if (error) fail(path, error.message);

  revalidatePath("/it/procurement/approvals");
  done(path, "Sent to the department head for approval.");
}

// Rejected → revise quantity / justification → Categorized, ready to send again (javaria_it_0013).
export async function reviseRejectedDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const justification = text(formData, "justification");
  const note = text(formData, "note");
  if (!justification) fail(path, "Justification can't be empty.");
  if (!note) fail(path, "Please say what changed for the approver.");

  const { error } = await supabase.schema("it").rpc("revise_rejected_demand", {
    p_demand_id: demandId,
    p_quantity: quantity(formData, path),
    p_justification: justification,
    p_note: note,
  });
  if (error) fail(path, error.message);

  const { data: after } = await supabase.schema("it").from("demands").select("status").eq("id", demandId).maybeSingle();
  done(
    path,
    after?.status === "Pending Approval"
      ? "Demand revised and sent back to the department head."
      : "Demand revised. It couldn't be routed automatically — see the timeline.",
  );
}

// BRD §5.5.5 — the approver's decision. Timestamp and approver are captured by the database.
export async function decideDemand(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.approve");

  const decision = text(formData, "decision") as ItDemandDecision;
  if (!DECISIONS.includes(decision)) fail(path, "Please choose a decision.");
  const comments = text(formData, "comments") || null;
  let approvedQuantity: number | null = null;
  if (decision === "Partially Approved") {
    approvedQuantity = Number(text(formData, "approvedQuantity"));
    if (!Number.isInteger(approvedQuantity)) fail(path, "Enter the quantity you approve.");
  }
  if (decision !== "Approved" && !comments) {
    fail(path, decision === "Rejected" ? "Please give a reason for rejecting." : "Please explain the partial approval.");
  }

  const { error } = await supabase.schema("it").rpc("decide_demand", {
    p_demand_id: demandId,
    p_decision: decision,
    p_approved_quantity: approvedQuantity,
    p_comments: comments,
  });
  if (error) fail(path, error.message);

  revalidatePath("/it/procurement/approvals");
  done(path, `Decision recorded: ${decision.toLowerCase()}.`);
}

// ---------------------------------------------------------------------------
// Phase 4 — vendor, receiving, documents (javaria_it_0012). The functions check the rules.
// ---------------------------------------------------------------------------

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100) || "file";
}

// Validates and returns the non-empty files of one or more inputs; fails the request otherwise.
function collectFiles(formData: FormData, keys: string[], path: string) {
  const files = keys.flatMap((key) =>
    formData
      .getAll(key)
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map((file) => ({ key, file })),
  );
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD) fail(path, `Attach at most ${MAX_DOCUMENTS_PER_UPLOAD} files at a time.`);
  if (files.some(({ file }) => file.size > MAX_DOCUMENT_BYTES)) fail(path, "Each file must be 5 MB or smaller.");
  if (files.reduce((sum, { file }) => sum + file.size, 0) > MAX_TOTAL_DOCUMENT_BYTES) {
    fail(path, "Files must be 8 MB or smaller in total.");
  }
  if (files.some(({ file }) => file.type && !DOCUMENT_MIME_TYPES.includes(file.type))) {
    fail(path, "Only photos (JPG, PNG, WEBP, HEIC) or PDF files can be attached.");
  }
  return files;
}

type Supabase = Awaited<ReturnType<typeof requirePermission>>["supabase"];

// Upload to the bucket, then register the row. Returns how many failed (the record itself is
// already saved, so a failed upload is reported, not fatal).
async function uploadDocuments(
  supabase: Supabase,
  demandId: string,
  receivingId: string | null,
  files: { file: File; docType: ItDocumentType }[],
) {
  let failed = 0;
  for (const { file, docType } of files) {
    const storagePath = `${demandId}/${randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, file, { contentType: file.type || undefined });
    if (uploadError) {
      failed++;
      continue;
    }
    const { error } = await supabase.schema("it").rpc("add_procurement_document", {
      p_demand_id: demandId,
      p_receiving_id: receivingId,
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

// BRD §5.5.7 / §5.6.8 — order from a vendor, or switch vendor.
export async function assignVendor(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const vendorId = text(formData, "vendorId");
  if (!vendorId) fail(path, "Please choose a vendor.");
  const agreedPrice = parseMoney(formData.get("agreedPrice"));
  if (agreedPrice === undefined) fail(path, "The agreed price must be a positive amount (e.g. 125000 or 125,000.50).");

  const { error } = await supabase.schema("it").rpc("assign_demand_vendor", {
    p_demand_id: demandId,
    p_vendor_id: vendorId,
    p_expected_date: text(formData, "expectedDate") || null,
    p_agreed_price: agreedPrice,
    p_note: text(formData, "note") || null,
  });
  if (error) fail(path, error.message);

  done(path, "Vendor saved.");
}

// BRD §5.5.8–5.5.9 — record a delivery. Challan / gate pass numbers and pictures are optional.
export async function recordReceiving(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const quantity = Number(text(formData, "quantity"));
  if (!Number.isInteger(quantity) || quantity < 0) fail(path, "Enter the quantity delivered (0 if nothing arrived).");
  const acceptedText = text(formData, "acceptedQuantity");
  const accepted = acceptedText === "" ? quantity : Number(acceptedText);
  if (!Number.isInteger(accepted) || accepted < 0 || accepted > quantity) {
    fail(path, "Accepted quantity must be between 0 and the quantity delivered.");
  }
  const receivedDate = text(formData, "receivedDate");
  if (!receivedDate) fail(path, "Enter the date the goods arrived.");
  const condition = text(formData, "condition") as ItReceivingCondition;
  if (!RECEIVING_CONDITIONS.includes(condition)) fail(path, "Choose the condition of the goods.");
  const files = collectFiles(formData, ["gatePassFiles", "challanFiles"], path);

  const { data: receivingId, error } = await supabase.schema("it").rpc("record_receiving", {
    p_demand_id: demandId,
    p_received_date: receivedDate,
    p_quantity: quantity,
    p_accepted_quantity: accepted,
    p_condition: condition,
    p_challan_no: text(formData, "challanNo") || null,
    p_gate_pass_no: text(formData, "gatePassNo") || null,
    p_remarks: text(formData, "remarks") || null,
  });
  if (error || !receivingId) fail(path, error?.message ?? "Could not record the delivery.");

  const failed = await uploadDocuments(
    supabase,
    demandId,
    receivingId,
    files.map(({ key, file }) => ({ file, docType: key === "gatePassFiles" ? "Gate Pass" : "Delivery Challan" })),
  );
  done(
    path,
    failed > 0
      ? `Delivery recorded, but ${failed} file(s) could not be uploaded — try again on the delivery.`
      : "Delivery recorded.",
  );
}

// Add the challan / gate pass number later.
export async function updateReceivingRefs(demandId: string, receivingId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const { error } = await supabase.schema("it").rpc("update_receiving_refs", {
    p_receiving_id: receivingId,
    p_challan_no: text(formData, "challanNo") || null,
    p_gate_pass_no: text(formData, "gatePassNo") || null,
  });
  if (error) fail(path, error.message);

  done(path, "Delivery updated.");
}

// Attach pictures / PDFs to the demand (receivingId null) or to one delivery.
export async function uploadDemandDocuments(demandId: string, receivingId: string | null, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase } = await requirePermission("it.demands.update");

  const docType = text(formData, "docType") as ItDocumentType;
  if (!DOCUMENT_TYPES.includes(docType)) fail(path, "Choose what the file is.");
  const files = collectFiles(formData, ["files"], path);
  if (files.length === 0) fail(path, "Choose a file to upload.");

  const failed = await uploadDocuments(
    supabase,
    demandId,
    receivingId,
    files.map(({ file }) => ({ file, docType })),
  );
  if (failed === files.length) fail(path, "The file(s) could not be uploaded.");
  done(path, failed > 0 ? `${files.length - failed} uploaded, ${failed} failed.` : "Uploaded.");
}

export async function addDemandComment(demandId: string, formData: FormData) {
  const path = `${LIST}/${demandId}`;
  const { supabase, personId } = await requireActiveUser();

  const body = text(formData, "body");
  if (!body) fail(path, "Comment can't be empty.");
  const internal = formData.get("internal") === "on";

  const { error } = await supabase.schema("it").from("demand_updates").insert({
    demand_id: demandId,
    author_person_id: personId,
    update_type: internal ? "work_note" : "comment",
    body,
    is_internal: internal,
  });
  if (error) fail(path, error.message);

  revalidatePath(path);
  queueItEmails();
  redirect(path);
}
