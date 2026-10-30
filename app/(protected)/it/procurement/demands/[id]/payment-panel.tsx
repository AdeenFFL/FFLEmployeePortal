import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import { DOCUMENT_ACCEPT, formatMoney, PAYMENT_METHODS, todayIso } from "@/lib/it/procurement";
import type { ItDocument, ItInvoice, ItPayment } from "@/types/database";
import {
  confirmInvoicePackage,
  recordPayment,
  returnInvoicePackage,
  sendPaymentReference,
} from "../finance-actions";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";
import { DocumentLinks } from "./document-links";

// Phase 6 (javaria_it_0015): Finance's part of one invoice — SLA, confirm / return, payments,
// vendor reference email. Read-only for everyone without Finance Processing. `back` sends the
// action's redirect to the Finance inbox instead of the demand page when used there.

const fileInputClass =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200";

export function PaymentBlock({
  demandId,
  invoice,
  payments,
  documents,
  urls,
  isFinance,
  vendorHasEmail,
  back,
}: {
  demandId: string;
  invoice: ItInvoice;
  payments: ItPayment[];
  documents: ItDocument[];
  urls: Map<string, string>;
  isFinance: boolean;
  vendorHasEmail: boolean;
  back?: "finance";
}) {
  if (!["Sent to Finance", "Confirmed", "Paid"].includes(invoice.status)) return null;

  const unpaid = Math.max(0, Number(invoice.invoice_amount) - Number(invoice.paid_amount));
  const today = todayIso();
  const overdue = invoice.status !== "Paid" && invoice.finance_due_on !== null && invoice.finance_due_on < today;
  const canPay = isFinance && (invoice.status === "Sent to Finance" || invoice.status === "Confirmed");

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-900">Finance</span>
        <span className="text-slate-600">
          Paid {formatMoney(invoice.paid_amount)} of {formatMoney(invoice.invoice_amount)}
          {unpaid > 0 && ` · ${formatMoney(unpaid)} unpaid`}
        </span>
        {invoice.status !== "Paid" && invoice.finance_due_on && (
          <StatusPill label={overdue ? `Overdue since ${formatDate(invoice.finance_due_on)}` : `Due ${formatDate(invoice.finance_due_on)}`} tone={overdue ? "negative" : "neutral"} />
        )}
      </div>
      {invoice.finance_confirmed_at && (
        <p className="mt-1 text-xs text-slate-500">Package confirmed {formatDateTime(invoice.finance_confirmed_at)}</p>
      )}

      {payments.length > 0 && (
        <ul className="mt-2 space-y-2">
          {payments.map((p) => (
            <li key={p.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{p.payment_number}</span>
                <span className="text-slate-700">
                  {formatMoney(p.paid_amount)} · {p.payment_method} · ref {p.payment_reference} · {formatDate(p.payment_date)}
                </span>
                <StatusPill
                  label={p.status === "Reference Sent to Vendor" ? "Vendor emailed" : "Vendor not emailed"}
                  tone={p.status === "Reference Sent to Vendor" ? "positive" : "neutral"}
                />
              </div>
              {p.remarks && <p className="mt-1 text-xs text-slate-500">{p.remarks}</p>}
              <DocumentLinks
                documents={documents.filter((d) => d.entity_type === "payment" && d.entity_id === p.id)}
                urls={urls}
              />
              {isFinance && vendorHasEmail && (
                <form action={sendPaymentReference.bind(null, demandId, p.id)} className="mt-1">
                  {back && <input type="hidden" name="back" value={back} />}
                  <button type="submit" className="text-xs font-medium text-blue-700 hover:underline">
                    {p.status === "Reference Sent to Vendor" ? "Re-send reference to vendor" : "Email reference to vendor"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {isFinance && invoice.status === "Sent to Finance" && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <form action={confirmInvoicePackage.bind(null, demandId, invoice.id)}>
            {back && <input type="hidden" name="back" value={back} />}
            <button type="submit" className={secondaryButtonClass}>
              Confirm package received
            </button>
          </form>
        </div>
      )}

      {canPay && (
        <details className="mt-3" open={back === "finance"}>
          <summary className="cursor-pointer text-sm font-medium text-blue-700">Record payment</summary>
          <form action={recordPayment.bind(null, demandId, invoice.id)} className="mt-2 space-y-3">
            {back && <input type="hidden" name="back" value={back} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Payment reference</span>
                <input name="reference" required placeholder="Cheque / transaction no." className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Payment date</span>
                <input type="date" name="paymentDate" required max={today} defaultValue={today} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Amount (Rs)</span>
                <input name="amount" inputMode="decimal" required defaultValue={unpaid.toFixed(2)} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Method</span>
                <select name="method" defaultValue="Bank Transfer" className={inputClass}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={labelClass}>Remarks</span>
              <input name="remarks" className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Payment proof (optional)</span>
              <input type="file" name="proofFiles" multiple accept={DOCUMENT_ACCEPT} className={fileInputClass} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="notifyVendor"
                defaultChecked={vendorHasEmail}
                disabled={!vendorHasEmail}
                className="h-4 w-4 rounded border-slate-300"
              />
              Email the payment reference to the vendor
              {!vendorHasEmail && <span className="text-xs text-slate-400">(no email in the Vendor Master)</span>}
            </label>
            <button type="submit" className={primaryButtonClass}>
              Record payment
            </button>
          </form>
        </details>
      )}

      {isFinance && Number(invoice.paid_amount) === 0 && (invoice.status === "Sent to Finance" || invoice.status === "Confirmed") && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-red-700">Return to procurement</summary>
          <form action={returnInvoicePackage.bind(null, demandId, invoice.id)} className="mt-2 flex flex-wrap gap-2">
            {back && <input type="hidden" name="back" value={back} />}
            <input
              name="reason"
              required
              placeholder="What's missing or wrong"
              aria-label="Reason for returning the package"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" className={secondaryButtonClass}>
              Return
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
