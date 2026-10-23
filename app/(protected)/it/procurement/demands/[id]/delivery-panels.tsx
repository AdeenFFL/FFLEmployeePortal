import { StatusPill } from "@/components/status-pill";
import { formatBytes, formatDate, formatDateTime } from "@/lib/it/tickets";
import { DOCUMENT_ACCEPT, formatMoney, RECEIVING_CONDITIONS, todayIso } from "@/lib/it/procurement";
import type { ItDemand, ItDocument, ItReceivingRecord } from "@/types/database";
import { assignVendor, recordReceiving, updateReceivingRefs, uploadDemandDocuments } from "../actions";
import { cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";

// Phase 4 panels for the demand page (javaria_it_0012): vendor, deliveries, documents.
// Server components; what's offered mirrors the database functions' rules.

const fileInputClass =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200";

export function DocumentLinks({ documents, urls }: { documents: ItDocument[]; urls: Map<string, string> }) {
  if (documents.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {documents.map((d) => {
        const url = urls.get(d.storage_path);
        return (
          <li key={d.id}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700"
              title={`${d.file_name} · ${formatBytes(d.size_bytes)} · ${formatDateTime(d.uploaded_at)}`}
            >
              <span className="font-medium">{d.doc_type}</span>
              <span className="max-w-40 truncate text-slate-400">{d.file_name}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function UploadForm({
  demandId,
  receivingId,
  defaultType,
  types,
}: {
  demandId: string;
  receivingId: string | null;
  defaultType: string;
  types: string[];
}) {
  return (
    <form action={uploadDemandDocuments.bind(null, demandId, receivingId)} className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select name="docType" defaultValue={defaultType} aria-label="Document type" className={`${inputClass} w-auto`}>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="file" name="files" multiple required accept={DOCUMENT_ACCEPT} className={`${fileInputClass} flex-1`} />
      </div>
      <button type="submit" className={secondaryButtonClass}>
        Upload
      </button>
      <p className="text-xs text-slate-400">Photo or PDF, up to 5 MB each, 3 at a time.</p>
    </form>
  );
}

// Main column: vendor summary, deliveries, demand documents.
export function DeliverySection({
  demand,
  unit,
  vendorName,
  names,
  receivings,
  documents,
  urls,
  canProcess,
}: {
  demand: ItDemand;
  unit: string;
  vendorName: string | null;
  names: Map<string, string>;
  receivings: ItReceivingRecord[];
  documents: ItDocument[];
  urls: Map<string, string>;
  canProcess: boolean;
}) {
  const target = demand.approved_quantity ?? demand.quantity;
  const due = Math.max(0, target - demand.received_quantity);
  const pct = target > 0 ? Math.min(100, Math.round((demand.received_quantity / target) * 100)) : 0;
  const demandDocs = documents.filter((d) => d.entity_type === "demand");
  const open = demand.status !== "Closed" && demand.status !== "Cancelled";

  return (
    <section className={`${cardClass} p-6`}>
      <h2 className="mb-4 text-base font-semibold text-slate-900">Vendor &amp; delivery</h2>

      <dl className="mb-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Vendor</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{vendorName ?? "Not assigned yet"}</dd>
          {demand.vendor_assigned_at && (
            <dd className="text-xs text-slate-400">
              {formatDate(demand.vendor_assigned_at)}
              {demand.vendor_assigned_by && ` · ${names.get(demand.vendor_assigned_by) ?? ""}`}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Expected delivery</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{formatDate(demand.expected_delivery_date) || "—"}</dd>
          {demand.agreed_unit_price !== null && (
            <dd className="text-xs text-slate-500">
              Agreed {formatMoney(demand.agreed_unit_price)} each ·{" "}
              {formatMoney(Number(demand.agreed_unit_price) * target)} total
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Accepted</dt>
          <dd className="mt-0.5 text-sm text-slate-800">
            {demand.received_quantity} of {target} {unit}
            {due > 0 && demand.received_quantity > 0 && <span className="text-amber-700"> · {due} still due</span>}
          </dd>
          <div
            className="mt-1 h-1.5 w-full rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Received"
          >
            <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </dl>

      {receivings.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">No deliveries recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {receivings.map((r) => {
            const docs = documents.filter((d) => d.entity_type === "receiving" && d.entity_id === r.id);
            const hasGateProof = Boolean(r.gate_pass_no) || docs.some((d) => d.doc_type === "Gate Pass");
            return (
              <li key={r.id} className="rounded-lg border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{r.receiving_number}</span>
                  <span className="text-slate-600">
                    {formatDate(r.received_date)} · {r.received_quantity} {unit} delivered
                    {r.accepted_quantity !== r.received_quantity && (
                      <span className="text-red-700"> · {r.accepted_quantity} accepted</span>
                    )}
                  </span>
                  <StatusPill
                    label={r.status}
                    tone={r.status === "Full" ? "positive" : r.status === "Partial" ? "warning" : "negative"}
                  />
                  {r.condition !== "Good" && <StatusPill label={r.condition} tone="negative" />}
                  {!hasGateProof && <StatusPill label="Gate pass pending" tone="warning" />}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Challan {r.delivery_challan_no ?? "—"} · Gate pass {r.gate_pass_no ?? "—"}
                  {r.received_by_person_id && ` · received by ${names.get(r.received_by_person_id) ?? "procurement"}`}
                </p>
                {r.remarks && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.remarks}</p>}
                <DocumentLinks documents={docs} urls={urls} />

                {canProcess && open && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-blue-700">
                      {hasGateProof ? "Edit numbers / add pictures" : "Add gate pass"}
                    </summary>
                    <form
                      action={updateReceivingRefs.bind(null, demand.id, r.id)}
                      className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                    >
                      <label className="block">
                        <span className={labelClass}>Challan no.</span>
                        <input name="challanNo" defaultValue={r.delivery_challan_no ?? ""} className={inputClass} />
                      </label>
                      <label className="block">
                        <span className={labelClass}>Gate pass no.</span>
                        <input name="gatePassNo" defaultValue={r.gate_pass_no ?? ""} className={inputClass} />
                      </label>
                      <button type="submit" className={secondaryButtonClass}>
                        Save
                      </button>
                    </form>
                    <UploadForm
                      demandId={demand.id}
                      receivingId={r.id}
                      defaultType={hasGateProof ? "Delivery Challan" : "Gate Pass"}
                      types={["Gate Pass", "Delivery Challan", "Photo", "Other"]}
                    />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(demandDocs.length > 0 || (canProcess && open)) && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Demand documents</h3>
          {demandDocs.length === 0 && <p className="text-xs text-slate-400">Quotations or other files for this demand.</p>}
          <DocumentLinks documents={demandDocs} urls={urls} />
          {canProcess && open && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-blue-700">Upload a document</summary>
              <UploadForm
                demandId={demand.id}
                receivingId={null}
                defaultType="Quotation"
                types={["Quotation", "Photo", "Other"]}
              />
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// Aside: choose / change the vendor.
export function VendorPanel({
  demand,
  vendors,
}: {
  demand: ItDemand;
  vendors: { id: string; vendor_name: string }[];
}) {
  const changing = Boolean(demand.vendor_id);
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className="mb-1 text-base font-semibold text-slate-900">{changing ? "Change vendor" : "Assign vendor"}</h2>
      <p className="mb-4 text-xs text-slate-500">
        {changing
          ? "If the vendor can't deliver, switch to another one. Deliveries already received stay recorded."
          : "Who is supplying this order, and when it's expected."}
      </p>
      {vendors.length === 0 ? (
        <p className="text-sm text-amber-700">No active vendors — add one in the Vendor Master first.</p>
      ) : (
        <form action={assignVendor.bind(null, demand.id)} className="space-y-3">
          <label className="block">
            <span className={labelClass}>Vendor</span>
            <select name="vendorId" required defaultValue={demand.vendor_id ?? ""} className={inputClass}>
              <option value="" disabled>
                Choose…
              </option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vendor_name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Expected delivery</span>
              <input
                type="date"
                name="expectedDate"
                defaultValue={demand.expected_delivery_date ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Agreed price each (Rs)</span>
              <input
                name="agreedPrice"
                inputMode="decimal"
                defaultValue={demand.agreed_unit_price ?? demand.estimated_unit_price ?? ""}
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Estimate was {formatMoney(demand.estimated_unit_price)}. Invoices are checked against the
            agreed price.
          </p>
          {changing && (
            <label className="block">
              <span className={labelClass}>Reason for the change</span>
              <input name="note" className={inputClass} placeholder="e.g. vendor out of stock" />
            </label>
          )}
          <button type="submit" className={primaryButtonClass}>
            {changing ? "Save vendor" : "Assign vendor"}
          </button>
        </form>
      )}
    </section>
  );
}

// Aside: record a delivery. Gate pass / challan numbers and pictures are optional.
export function ReceivingPanel({
  demand,
  unit,
  isFixedAsset,
}: {
  demand: ItDemand;
  unit: string;
  isFixedAsset: boolean;
}) {
  const target = demand.approved_quantity ?? demand.quantity;
  const due = Math.max(0, target - demand.received_quantity);
  const today = todayIso();
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Record delivery</h2>
      <p className="mb-4 text-xs text-slate-500">
        {due} {unit} still due. Record 0 if the vendor didn&apos;t deliver.
      </p>
      <form action={recordReceiving.bind(null, demand.id)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Date received</span>
            <input type="date" name="receivedDate" required max={today} defaultValue={today} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Delivered</span>
            <input type="number" name="quantity" required min={0} max={due} defaultValue={due} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Accepted (leave empty if all are fine)</span>
          <input type="number" name="acceptedQuantity" min={0} max={due} className={inputClass} />
          <span className="mt-1 block text-xs text-slate-400">
            Damaged or wrong items aren&apos;t accepted — they stay due from the vendor. Explain in the remarks.
          </span>
        </label>
        <label className="block">
          <span className={labelClass}>Condition</span>
          <select name="condition" defaultValue="Good" className={inputClass}>
            {RECEIVING_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">Gate pass (optional)</legend>
          <input name="gatePassNo" placeholder="Gate pass no." aria-label="Gate pass number" className={inputClass} />
          <input
            type="file"
            name="gatePassFiles"
            multiple
            accept={DOCUMENT_ACCEPT}
            capture="environment"
            aria-label="Gate pass picture"
            className={fileInputClass}
          />
        </fieldset>
        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">Delivery challan (optional)</legend>
          <input name="challanNo" placeholder="Challan no." aria-label="Delivery challan number" className={inputClass} />
          <input
            type="file"
            name="challanFiles"
            multiple
            accept={DOCUMENT_ACCEPT}
            capture="environment"
            aria-label="Delivery challan picture"
            className={fileInputClass}
          />
        </fieldset>

        <label className="block">
          <span className={labelClass}>Remarks</span>
          <textarea
            name="remarks"
            rows={3}
            className={inputClass}
            placeholder={isFixedAsset ? "Serial numbers of the items received, one per line" : "Anything to note"}
          />
        </label>
        {isFixedAsset && (
          <p className="text-xs text-slate-500">
            Fixed-asset product: note the serial numbers above, then register the items on the Asset
            Register (automatic registration comes with the inventory module).
          </p>
        )}
        <p className="text-xs text-slate-400">
          Gate pass number or picture can also be added later. One of them is needed before the invoice
          goes to Finance.
        </p>
        <button type="submit" className={primaryButtonClass}>
          Record delivery
        </button>
      </form>
    </section>
  );
}
