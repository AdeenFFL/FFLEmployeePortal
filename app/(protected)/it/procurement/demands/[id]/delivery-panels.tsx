import { StatusPill } from "@/components/status-pill";
import { formatDate } from "@/lib/it/tickets";
import { DOCUMENT_ACCEPT, formatMoney, RECEIVING_CONDITIONS, todayIso } from "@/lib/it/procurement";
import type { ItDemand, ItDocument, ItInvoice, ItPayment, ItReceivingRecord } from "@/types/database";
import Link from "next/link";
import { DocumentLinks } from "./document-links";
import { RegisterAssetsForm } from "./register-assets-form";
import { InvoiceBlock } from "./invoice-panel";
import { assignVendor, recordDeviceBack, recordReceiving, registerAssets, updateReceivingRefs, uploadDemandDocuments } from "../actions";
import { cardClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";

// Phase 4 panels for the demand page (javaria_it_0012): vendor, deliveries, documents.
// Server components; what's offered mirrors the database functions' rules.

const fileInputClass =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200";

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
  invoices,
  canManageInvoices,
  canApproveInvoices,
  personId,
  payments,
  isFinance,
  vendorHasEmail,
  productName,
  showAmounts,
  assetRegistration,
}: {
  demand: ItDemand;
  unit: string;
  vendorName: string | null;
  names: Map<string, string>;
  receivings: ItReceivingRecord[];
  documents: ItDocument[];
  urls: Map<string, string>;
  canProcess: boolean;
  invoices: ItInvoice[];
  canManageInvoices: boolean;
  canApproveInvoices: boolean;
  personId: string | null;
  payments: ItPayment[];
  isFinance: boolean;
  vendorHasEmail: boolean;
  productName: string;
  showAmounts: boolean;
  // Set only for fixed-asset products (asset type classified Fixed).
  assetRegistration: { assets: ReceiptAsset[]; canRegister: boolean; companies: { id: string; name: string }[] } | null;
}) {
  const unitPrice = demand.agreed_unit_price ?? demand.estimated_unit_price;
  const target = demand.approved_quantity ?? demand.quantity;
  const due = Math.max(0, target - demand.received_quantity);
  const pct = target > 0 ? Math.min(100, Math.round((demand.received_quantity / target) * 100)) : 0;
  const demandDocs = documents.filter((d) => d.entity_type === "demand");
  const open = demand.status !== "Closed" && demand.status !== "Cancelled";

  return (
    <section className={`${cardClass} p-6`}>
      <h2 className="mb-4 text-base font-semibold text-slate-900">
        {demand.asset_id ? "Vendor & repair" : "Vendor & delivery"}
      </h2>

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
          {showAmounts && demand.agreed_unit_price !== null && (
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
            // A repair needs no gate pass (javaria_it_0023).
            const hasGateProof =
              Boolean(demand.asset_id) || Boolean(r.gate_pass_no) || docs.some((d) => d.doc_type === "Gate Pass");
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

                {assetRegistration && r.accepted_quantity > 0 && (
                  <ReceiptAssets demandId={demand.id} receiving={r} productName={productName} {...assetRegistration} />
                )}

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

                <InvoiceBlock
                  demandId={demand.id}
                  receiving={r}
                  invoice={invoices.find((i) => i.receiving_id === r.id) ?? null}
                  documents={documents}
                  urls={urls}
                  names={names}
                  expectedAmount={unitPrice === null ? null : Number(unitPrice) * r.accepted_quantity}
                  hasGateProof={hasGateProof}
                  canManage={canManageInvoices}
                  canApprove={canApproveInvoices}
                  personId={personId}
                  open={open}
                  payments={payments}
                  isFinance={isFinance}
                  vendorHasEmail={vendorHasEmail}
                />
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

export type ReceiptAsset = {
  id: string;
  asset_tag: string;
  serial_number: string;
  status: string;
  receiving_id: string | null;
};

// Receiving → assets (javaria_it_0021): which accepted items of this delivery are already in the
// Asset Register, and the form to register the rest.
function ReceiptAssets({
  demandId,
  receiving,
  productName,
  assets,
  canRegister,
  companies,
}: {
  demandId: string;
  receiving: ItReceivingRecord;
  productName: string;
  assets: ReceiptAsset[];
  canRegister: boolean;
  companies: { id: string; name: string }[];
}) {
  const mine = assets.filter((a) => a.receiving_id === receiving.id);
  const remaining = Math.max(0, receiving.accepted_quantity - mine.length);
  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">
          Assets{" "}
          <span className="font-normal text-slate-500">
            · {mine.length} of {receiving.accepted_quantity} registered
          </span>
        </p>
        {remaining === 0 ? (
          <StatusPill label="All registered" tone="positive" />
        ) : (
          <StatusPill label={`${remaining} to register`} tone="warning" />
        )}
      </div>
      {mine.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {mine.map((a) => (
            <li key={a.id}>
              <Link
                href={`/it/inventory/${a.id}`}
                title={`Serial ${a.serial_number} · ${a.status}`}
                className="inline-block rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700"
              >
                {a.asset_tag}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {remaining > 0 &&
        (canRegister ? (
          <details className="mt-2" open={mine.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">
              Register {remaining} asset{remaining === 1 ? "" : "s"}
            </summary>
            <RegisterAssetsForm
              key={remaining}
              action={registerAssets.bind(null, demandId, receiving.id)}
              remaining={remaining}
              productName={productName}
              companies={companies}
            />
          </details>
        ) : (
          <p className="mt-1 text-xs text-slate-500">IT inventory staff register these in the Asset Register.</p>
        ))}
    </div>
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

// Aside on a repair demand: the device is back. Takes the place of Record delivery.
export function DeviceBackPanel({
  demandId,
  parts,
}: {
  demandId: string;
  parts: { id: string; name: string; unit: string; onHand: number }[];
}) {
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Device back</h2>
      <p className="mb-4 text-xs text-slate-500">
        The asset goes back to its holder or to stock, and a linked ticket resolves.
      </p>
      <form action={recordDeviceBack.bind(null, demandId)} className="space-y-3">
        <label className="block">
          <span className={labelClass}>How was it fixed? *</span>
          <textarea name="resolution" required rows={2} placeholder="e.g. Battery replaced" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Date back</span>
          <input type="date" name="returnedDate" defaultValue={todayIso()} max={todayIso()} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Condition</span>
          <select name="condition" defaultValue="Good" className={inputClass}>
            {RECEIVING_CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className={labelClass}>Spare parts from stock</legend>
          {parts.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing in stock at this site.</p>
          ) : (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem] gap-2">
                  <select name="partProduct" defaultValue="" aria-label={`Part ${i + 1}`} className={inputClass}>
                    <option value="">No part</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.onHand} {p.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    name="partQty"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={1}
                    aria-label={`Quantity of part ${i + 1}`}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          )}
        </fieldset>
        <label className="block">
          <span className={labelClass}>Gate pass no. (if it left the site)</span>
          <input name="gatePassNo" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Remarks</span>
          <input name="remarks" className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="noBill" className="h-4 w-4 rounded border-slate-300" />
          No bill (warranty or free): close the demand now
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/50 p-2.5 text-sm text-slate-700">
          <input type="checkbox" name="beyondRepair" className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span>
            <span className="font-medium text-red-700">Beyond repair</span>
            <span className="block text-xs text-slate-500">
              The device is retired instead of going back. The ticket stays open so IT can use Replace device.
            </span>
          </span>
        </label>
        <button type="submit" className={primaryButtonClass}>
          Record device back
        </button>
      </form>
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
            placeholder="Anything to note"
          />
        </label>
        {isFixedAsset && (
          <p className="text-xs text-slate-500">
            Fixed-asset product: after saving, register each accepted item as an asset (tag + serial)
            on the delivery.
          </p>
        )}
        {!isFixedAsset && (
          <p className="text-xs text-slate-500">
            Consumable: the accepted quantity is added to stock at this site automatically.
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
