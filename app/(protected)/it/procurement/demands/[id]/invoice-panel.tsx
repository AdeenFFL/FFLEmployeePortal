import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import { DOCUMENT_ACCEPT, formatMoney, INVOICE_STATUS_TONE, todayIso } from "@/lib/it/procurement";
import type { ItDocument, ItInvoice, ItPayment, ItReceivingRecord } from "@/types/database";
import { PaymentBlock } from "./payment-panel";
import {
  clearInvoiceFlag,
  decideInvoice,
  logInvoice,
  sendInvoiceToFinance,
  submitInvoice,
  updateInvoice,
  uploadInvoiceFiles,
} from "../invoice-actions";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";
import { DocumentLinks } from "./document-links";

// Phase 5 (javaria_it_0014): the invoice for ONE delivery, inside that delivery's card on the
// demand page. Offers only the next step the database will allow.

const fileInputClass =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200";

function InvoiceFields({ invoice, defaultQuantity }: { invoice?: ItInvoice; defaultQuantity: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>Vendor&apos;s invoice no.</span>
        <input name="invoiceNumber" required defaultValue={invoice?.invoice_number ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Invoice date</span>
        <input
          type="date"
          name="invoiceDate"
          required
          max={todayIso()}
          defaultValue={invoice?.invoice_date ?? todayIso()}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Quantity billed</span>
        <input
          type="number"
          name="quantity"
          min={0}
          required
          defaultValue={invoice?.invoice_quantity ?? defaultQuantity}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Total incl. tax (Rs)</span>
        <input name="amount" inputMode="decimal" required defaultValue={invoice?.invoice_amount ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Of which tax (Rs)</span>
        <input name="tax" inputMode="decimal" defaultValue={invoice?.tax_amount ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>GL / cost center</span>
        <input
          name="costCenter"
          defaultValue={invoice?.cost_center ?? ""}
          placeholder="e.g. 6105-IT"
          className={inputClass}
        />
      </label>
      <label className="block sm:col-span-2">
        <span className={labelClass}>Notes</span>
        <input name="notes" defaultValue={invoice?.notes ?? ""} className={inputClass} />
      </label>
    </div>
  );
}

export function InvoiceBlock({
  demandId,
  receiving,
  invoice,
  documents,
  urls,
  names,
  expectedAmount,
  hasGateProof,
  canManage,
  canApprove,
  personId,
  open,
  payments,
  isFinance,
  vendorHasEmail,
}: {
  demandId: string;
  receiving: ItReceivingRecord;
  invoice: ItInvoice | null;
  documents: ItDocument[];
  urls: Map<string, string>;
  names: Map<string, string>;
  expectedAmount: number | null;
  hasGateProof: boolean;
  canManage: boolean;
  canApprove: boolean;
  personId: string | null;
  open: boolean;
  payments: ItPayment[];
  isFinance: boolean;
  vendorHasEmail: boolean;
}) {
  if (receiving.accepted_quantity === 0) return null;

  if (!invoice) {
    // Invoices are visible only to procurement / approvers / Finance (javaria_it_0016), so a
    // requester seeing none doesn't mean there is none — say nothing to them.
    if (!canManage || !open) return null;
    return (
      <details className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
        <summary className="cursor-pointer text-sm font-medium text-blue-700">Log invoice</summary>
        <p className="mt-2 text-xs text-slate-500">
          Expected: {receiving.accepted_quantity} accepted × agreed price = {formatMoney(expectedAmount)} before tax.
          The invoice is checked against this automatically.
        </p>
        <form action={logInvoice.bind(null, demandId, receiving.id)} className="mt-3 space-y-3">
          <InvoiceFields defaultQuantity={receiving.accepted_quantity} />
          <label className="block">
            <span className={labelClass}>Invoice file (needed before it goes to Finance)</span>
            <input type="file" name="invoiceFiles" multiple accept={DOCUMENT_ACCEPT} className={fileInputClass} />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Log invoice
          </button>
        </form>
      </details>
    );
  }

  const invoiceDocs = documents.filter((d) => d.entity_type === "invoice" && d.entity_id === invoice.id);
  const hasFile = invoiceDocs.some((d) => d.doc_type === "Invoice");
  const editable = ["Logged", "Verified", "Flagged", "Revise"].includes(invoice.status);
  const net = Number(invoice.invoice_amount) - Number(invoice.tax_amount);
  const canDecide = canApprove && invoice.status === "Pending Approval" && invoice.created_by !== personId;
  const financeBlockers = [
    !hasGateProof && "gate pass number or picture on this delivery",
    !hasFile && "the invoice file",
  ].filter(Boolean) as string[];

  return (
    <div
      className={`mt-3 rounded-lg border p-3 ${
        invoice.status === "Flagged" ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-900">Invoice {invoice.invoice_number}</span>
        <StatusPill label={invoice.status} tone={INVOICE_STATUS_TONE[invoice.status]} />
        <Link
          href={`/it/procurement/invoices/${invoice.id}`}
          className="ml-auto text-xs font-medium text-blue-700 hover:underline"
        >
          View package →
        </Link>
        <span className="text-slate-600">
          {formatDate(invoice.invoice_date)} · {invoice.invoice_quantity} billed · {formatMoney(invoice.invoice_amount)}
          {Number(invoice.tax_amount) > 0 && ` (tax ${formatMoney(invoice.tax_amount)})`}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Before tax {formatMoney(net)} · expected {formatMoney(invoice.expected_amount)}
        {invoice.cost_center && ` · cost center ${invoice.cost_center}`}
        {invoice.approved_at &&
          ` · approved ${formatDateTime(invoice.approved_at)} by ${names.get(invoice.approved_by ?? "") ?? "approver"}`}
        {invoice.sent_to_finance_at && ` · sent to Finance ${formatDateTime(invoice.sent_to_finance_at)}`}
      </p>
      {invoice.verification_notes && (
        <p className={`mt-1 text-xs ${invoice.status === "Flagged" ? "font-medium text-red-700" : "text-slate-500"}`}>
          {invoice.status === "Flagged" ? "Mismatch: " : "Checked: "}
          {invoice.verification_notes}
        </p>
      )}
      {invoice.flag_clear_note && (
        <p className="mt-1 text-xs text-slate-600">
          Mismatch accepted by {names.get(invoice.flag_cleared_by ?? "") ?? "procurement"}: {invoice.flag_clear_note}
        </p>
      )}
      {invoice.status === "Revise" && invoice.revision_reason && (
        <p className="mt-1 text-xs font-medium text-amber-800">Sent back: {invoice.revision_reason}</p>
      )}
      {invoice.status === "Approved" && invoice.revision_reason && (
        <p className="mt-1 text-xs font-medium text-amber-800">Returned by Finance: {invoice.revision_reason}</p>
      )}
      {invoice.approval_comments && invoice.status !== "Revise" && (
        <p className="mt-1 text-xs text-slate-600">Approver: {invoice.approval_comments}</p>
      )}
      <DocumentLinks documents={invoiceDocs} urls={urls} />

      <div className="mt-2 flex flex-wrap items-start gap-3">
        {canManage && invoice.status === "Verified" && (
          <form action={submitInvoice.bind(null, demandId, invoice.id)}>
            <button type="submit" className={primaryButtonClass}>
              Send for approval
            </button>
          </form>
        )}
        {canManage && invoice.status === "Approved" && (
          <div>
            <form action={sendInvoiceToFinance.bind(null, demandId, invoice.id)}>
              <button type="submit" className={primaryButtonClass} disabled={financeBlockers.length > 0}>
                Send to Finance
              </button>
            </form>
            {financeBlockers.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">Needs {financeBlockers.join(" and ")} first.</p>
            )}
          </div>
        )}
      </div>

      {canManage && invoice.status === "Flagged" && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-blue-700">Accept the difference</summary>
          <form action={clearInvoiceFlag.bind(null, demandId, invoice.id)} className="mt-2 flex flex-wrap gap-2">
            <input
              name="note"
              required
              placeholder="Why it's acceptable (e.g. freight agreed with the vendor)"
              aria-label="Reason the mismatch is acceptable"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" className={secondaryButtonClass}>
              Clear flag
            </button>
          </form>
        </details>
      )}

      {canDecide && (
        <form action={decideInvoice.bind(null, demandId, invoice.id)} className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">Your decision</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="decision" value="Approved" defaultChecked /> Approve
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="decision" value="Revise" /> Send back for revision
            </label>
          </div>
          <input name="comments" placeholder="Comments (required to send back)" aria-label="Comments" className={inputClass} />
          <button type="submit" className={primaryButtonClass}>
            Record decision
          </button>
        </form>
      )}
      {canApprove && invoice.status === "Pending Approval" && invoice.created_by === personId && (
        <p className="mt-2 text-xs text-slate-500">You logged this invoice, so another approver decides.</p>
      )}

      {canManage && open && editable && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit invoice</summary>
          <form action={updateInvoice.bind(null, demandId, invoice.id)} className="mt-2 space-y-3">
            <InvoiceFields invoice={invoice} defaultQuantity={receiving.accepted_quantity} />
            <button type="submit" className={secondaryButtonClass}>
              Save &amp; re-check
            </button>
          </form>
        </details>
      )}
      {canManage && open && !["Sent to Finance", "Confirmed", "Paid"].includes(invoice.status) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-blue-700">
            {hasFile ? "Add another file" : "Upload invoice file"}
          </summary>
          <form action={uploadInvoiceFiles.bind(null, demandId, invoice.id)} className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select name="docType" defaultValue={hasFile ? "Approval" : "Invoice"} aria-label="File type" className={`${inputClass} w-auto`}>
                <option value="Invoice">Invoice</option>
                <option value="Approval">Cost center sign-off</option>
                <option value="Other">Other</option>
              </select>
              <input type="file" name="files" multiple required accept={DOCUMENT_ACCEPT} className={`${fileInputClass} flex-1`} />
            </div>
            <button type="submit" className={secondaryButtonClass}>
              Upload
            </button>
          </form>
        </details>
      )}

      <PaymentBlock
        demandId={demandId}
        invoice={invoice}
        payments={payments.filter((p) => p.invoice_id === invoice.id)}
        documents={documents}
        urls={urls}
        isFinance={isFinance}
        vendorHasEmail={vendorHasEmail}
      />
    </div>
  );
}
