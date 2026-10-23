import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { formatDateTime } from "@/lib/it/tickets";
import {
  DEMAND_CATEGORIES,
  DEMAND_CONSUMABLE_PATH,
  DEMAND_MAIN_PATH,
  DEMAND_STATUS_TONE,
  demandCategoryLabel,
  DOCUMENT_BUCKET,
  formatMoney,
} from "@/lib/it/procurement";
import { DeliverySection, ReceivingPanel, VendorPanel } from "./delivery-panels";
import type { ItDemand } from "@/types/database";
import {
  addDemandComment,
  cancelDemand,
  categorizeDemand,
  closeDemand,
  decideDemand,
  editDemand,
  markStockUpdated,
  reviseRejectedDemand,
  submitForApproval,
} from "../actions";
import {
  cardClass,
  Fact,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  Timeline,
} from "../../../_components/ticket-ui";

// Step tracker: done / current / upcoming along the path this demand takes.
function Steps({ demand }: { demand: Pick<ItDemand, "status" | "demand_category"> }) {
  if (demand.status === "Cancelled" || demand.status === "Rejected") {
    return null;
  }
  const path = demand.demand_category === "Consumable" && demand.status !== "Pending Approval"
    ? DEMAND_CONSUMABLE_PATH
    : DEMAND_MAIN_PATH;
  // Statuses not on the drawn path map to the step they sit on.
  const position: Partial<Record<ItDemand["status"], ItDemand["status"]>> = {
    "Partially Approved": "Approved",
    "Partially Received": "Received",
  };
  const current = path.indexOf(position[demand.status] ?? demand.status);
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Demand progress">
      {path.map((step, i) => {
        const state = i < current || demand.status === "Closed" ? "done" : i === current ? "current" : "next";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              state === "done"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : state === "current"
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-400"
            }`}
          >
            {state === "done" ? "✓ " : ""}
            {step}
          </li>
        );
      })}
    </ol>
  );
}

// PRC-05 — one page for everyone involved (requester, site procurement, HQ). What's shown and
// offered follows the same rules the database enforces (javaria_it_0010_demands.sql).
export default async function DemandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const supabase = await createClient();

  const { data: demand } = checked(
    await supabase.schema("it").from("demands").select("*").eq("id", id).maybeSingle(),
  );
  if (!demand) notFound();

  const [
    { data: personId },
    { data: canProcess },
    { data: staffView },
    updatesRes,
    orgUnits,
    productsRes,
    settingsRes,
    vendorRes,
    { data: isApprover },
    approvalsRes,
    approversRes,
  ] = await Promise.all([
      supabase.rpc("current_person_id"),
      supabase.schema("it").rpc("can_process_demand", { p_site_id: demand.site_id }),
      supabase.schema("it").rpc("can_see_site_demands", { p_site_id: demand.site_id }),
      supabase
        .schema("it")
        .from("demand_updates")
        .select("id, author_person_id, update_type, body, is_internal, created_at")
        .eq("demand_id", id)
        .order("created_at"),
      fetchOrgUnits(supabase),
      supabase
        .schema("it")
        .from("products")
        .select("id, product_name, unit, category, is_active, asset_type_id")
        .order("product_name"),
      supabase.schema("it").from("procurement_settings").select("consumable_path_enabled").eq("id", true).maybeSingle(),
      demand.vendor_id
        ? supabase.schema("it").from("vendors").select("vendor_name").eq("id", demand.vendor_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.schema("it").rpc("is_demand_approver", { p_department_id: demand.department_id }),
      supabase
        .schema("it")
        .from("demand_approvals")
        .select("*")
        .eq("demand_id", id)
        .order("decided_at"),
      supabase.schema("it").rpc("list_department_approvers"),
    ]);

  // Phase 4 — deliveries, documents, vendor choices.
  const [receivingsRes, documentsRes, vendorsRes] = await Promise.all([
    supabase.schema("it").from("receiving_records").select("*").eq("demand_id", id).order("received_date"),
    supabase.schema("it").from("documents").select("*").eq("demand_id", id).order("uploaded_at"),
    canProcess
      ? supabase.schema("it").from("vendors").select("id, vendor_name").eq("is_active", true).order("vendor_name")
      : Promise.resolve({ data: [] as { id: string; vendor_name: string }[] }),
  ]);
  const receivings = receivingsRes.data ?? [];
  const documents = documentsRes.data ?? [];
  const docPaths = documents.map((d) => d.storage_path);
  const { data: signed } = docPaths.length
    ? await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrls(docPaths, 600)
    : { data: [] };
  const docUrls = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) docUrls.set(s.path, s.signedUrl);
  }

  const approvals = approvalsRes.data ?? [];
  const departmentApprovers = (approversRes.data ?? []).filter(
    (a) => a.department_id === demand.department_id && a.can_approve_demands && a.has_permission,
  );
  const latestDecision = approvals.at(-1);

  const updates = updatesRes.data ?? [];
  const products = productsRes.data ?? [];
  const product = products.find((p) => p.id === demand.product_id);
  const isOwner = demand.requested_by_person_id === personId;
  const consumablePath = settingsRes.data?.consumable_path_enabled ?? true;

  const peopleIds = [
    demand.requested_by_person_id,
    demand.categorized_by,
    demand.stock_updated_by,
    demand.cancelled_by,
    demand.vendor_assigned_by,
    ...receivings.map((r) => r.received_by_person_id),
    ...approvals.map((a) => a.approver_person_id),
    ...updates.map((u) => u.author_person_id),
  ].filter((v): v is string => Boolean(v));
  const { data: people } = await supabase
    .schema("it")
    .rpc("demand_person_names", { p_person_ids: [...new Set(peopleIds)] });
  const names = new Map((people ?? []).map((p) => [p.person_id, p.full_name]));

  const total =
    demand.estimated_unit_price === null ? null : Number(demand.estimated_unit_price) * demand.quantity;
  const canEdit = demand.status === "Open" && (isOwner || Boolean(canProcess));
  const canCategorize = Boolean(canProcess) && (demand.status === "Open" || demand.status === "Categorized");
  const canStock =
    Boolean(canProcess) && demand.status === "Categorized" && demand.demand_category === "Consumable" && consumablePath;
  const canClose = Boolean(canProcess) && demand.status === "Stock Updated";
  // A consumable can also go for purchase (e.g. out of stock), so both panels can show.
  const canSubmit = Boolean(canProcess) && demand.status === "Categorized";
  const canAssignVendor =
    Boolean(canProcess) &&
    ["Approved", "Partially Approved", "Assigned to Vendor", "Partially Received"].includes(demand.status);
  const canReceive =
    Boolean(canProcess) && (demand.status === "Assigned to Vendor" || demand.status === "Partially Received");
  const showDelivery =
    Boolean(demand.vendor_id) || receivings.length > 0 || documents.length > 0 || canAssignVendor;
  const canDecide = Boolean(isApprover) && !isOwner && demand.status === "Pending Approval";
  const canRevise = Boolean(canProcess) && demand.status === "Rejected";
  // javaria_it_0013: procurement may cancel up to Assigned to Vendor (and Rejected) while nothing
  // has been accepted.
  const canCancel =
    (isOwner && demand.status === "Open") ||
    (Boolean(canProcess) &&
      demand.received_quantity === 0 &&
      [
        "Open",
        "Categorized",
        "Pending Approval",
        "Approved",
        "Partially Approved",
        "Assigned to Vendor",
        "Rejected",
      ].includes(demand.status));

  return (
    <div className="py-6">
      <PageHeader
        title={`Demand ${demand.demand_number}`}
        description={`${demand.quantity} × ${product?.product_name ?? "product"} · ${
          orgUnits.nameById.get(demand.site_id) ?? "site"
        }`}
        action={
          <Link href="/it/procurement/demands" className={secondaryButtonClass}>
            Back to demands
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />
      <Steps demand={demand} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill label={demand.status} tone={DEMAND_STATUS_TONE[demand.status]} />
              <StatusPill
                label={demandCategoryLabel(demand.demand_category)}
                tone={demand.demand_category ? "info" : "neutral"}
              />
              {product && (
                <StatusPill label={product.asset_type_id ? "Fixed asset" : "Consumable / service"} tone="neutral" />
              )}
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Product">
                {product?.product_name ?? "—"}
                {product?.category ? <span className="text-slate-500"> · {product.category}</span> : null}
              </Fact>
              <Fact label="Quantity">
                {demand.quantity} {product?.unit ?? ""}
                {demand.approved_quantity !== null && (
                  <span className="text-slate-500"> · approved {demand.approved_quantity}</span>
                )}
              </Fact>
              <Fact label="Estimated unit price">{formatMoney(demand.estimated_unit_price)}</Fact>
              <Fact label="Estimated total">{formatMoney(total)}</Fact>
              <Fact label="Department">{orgUnits.nameById.get(demand.department_id) ?? "—"}</Fact>
              <Fact label="Site">{orgUnits.nameById.get(demand.site_id) ?? "—"}</Fact>
              <Fact label="Requested by">{names.get(demand.requested_by_person_id) ?? "—"}</Fact>
              <Fact label="Raised">{formatDateTime(demand.created_at)}</Fact>
              {demand.categorized_at && (
                <Fact label="Categorised">
                  {formatDateTime(demand.categorized_at)}
                  {demand.categorized_by && ` by ${names.get(demand.categorized_by) ?? "procurement"}`}
                </Fact>
              )}
            </dl>
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Justification</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{demand.justification}</p>
            </div>
            {demand.stock_note && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <strong>Issued from stock</strong>
                {demand.stock_updated_at && ` · ${formatDateTime(demand.stock_updated_at)}`}
                {demand.stock_updated_by && ` · ${names.get(demand.stock_updated_by) ?? ""}`}
                <p className="mt-1 whitespace-pre-wrap">{demand.stock_note}</p>
              </div>
            )}
            {demand.status === "Cancelled" && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <strong>Cancelled</strong>
                {demand.cancelled_at && ` · ${formatDateTime(demand.cancelled_at)}`}
                {demand.cancelled_by && ` · ${names.get(demand.cancelled_by) ?? ""}`}
                <p className="mt-1 whitespace-pre-wrap">{demand.cancellation_reason}</p>
              </div>
            )}

            {canEdit && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit demand</summary>
                <form action={editDemand.bind(null, demand.id)} className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="block md:col-span-2">
                      <span className={labelClass}>Product</span>
                      <select name="productId" defaultValue={demand.product_id} className={inputClass}>
                        {products
                          .filter((p) => p.is_active || p.id === demand.product_id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.product_name}
                              {p.is_active ? "" : " (inactive)"}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelClass}>Quantity</span>
                      <input
                        type="number"
                        name="quantity"
                        min={1}
                        max={100000}
                        required
                        defaultValue={demand.quantity}
                        className={inputClass}
                      />
                    </label>
                    <label className="block md:col-span-3">
                      <span className={labelClass}>Department</span>
                      <select name="departmentId" defaultValue={demand.department_id} className={inputClass}>
                        {orgUnits.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block md:col-span-3">
                      <span className={labelClass}>Justification</span>
                      <textarea
                        name="justification"
                        rows={3}
                        required
                        defaultValue={demand.justification}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <button type="submit" className={primaryButtonClass}>
                    Save changes
                  </button>
                </form>
              </details>
            )}
          </section>

          {approvals.length > 0 && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-4 text-base font-semibold text-slate-900">Approval</h2>
              <ul className="space-y-3">
                {approvals.map((a) => (
                  <li
                    key={a.id}
                    className={`rounded-lg border px-4 py-3 text-sm ${
                      a.decision === "Rejected"
                        ? "border-red-200 bg-red-50"
                        : a.decision === "Partially Approved"
                          ? "border-amber-200 bg-amber-50"
                          : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <p className="font-medium text-slate-900">
                      {a.decision}
                      {a.decision !== "Rejected" && ` · ${a.approved_quantity} of ${demand.quantity}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {names.get(a.approver_person_id) ?? "Approver"} · {formatDateTime(a.decided_at)}
                    </p>
                    {a.comments && <p className="mt-1 whitespace-pre-wrap text-slate-700">{a.comments}</p>}
                  </li>
                ))}
              </ul>
              {latestDecision &&
                latestDecision.decision !== "Rejected" &&
                (demand.status === "Approved" || demand.status === "Partially Approved") && (
                  <p className="mt-3 text-xs text-slate-500">Next: procurement assigns a vendor.</p>
                )}
            </section>
          )}

          {showDelivery && (
            <DeliverySection
              demand={demand}
              unit={product?.unit ?? ""}
              vendorName={vendorRes.data?.vendor_name ?? null}
              names={names}
              receivings={receivings}
              documents={documents}
              urls={docUrls}
              canProcess={Boolean(canProcess)}
            />
          )}

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Timeline</h2>
            <Timeline updates={updates} names={names} />
            <form action={addDemandComment.bind(null, demand.id)} className="mt-4 space-y-3">
              <label className="block">
                <span className="sr-only">Add a comment</span>
                <textarea
                  name="body"
                  rows={3}
                  required
                  placeholder={isOwner ? "Add a comment for procurement…" : "Add a comment…"}
                  className={inputClass}
                />
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" className={primaryButtonClass}>
                  Add comment
                </button>
                {staffView && !isOwner && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" name="internal" className="h-4 w-4 rounded border-slate-300" />
                    Internal note (hidden from the requester)
                  </label>
                )}
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-6">
          {canCategorize && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">
                {demand.status === "Open" ? "Categorise" : "Change category"}
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Consumables are issued from stock; everything else goes to the department head for
                approval.
              </p>
              <form action={categorizeDemand.bind(null, demand.id, demand.status)} className="space-y-3">
                <fieldset className="space-y-2">
                  <legend className="sr-only">Category</legend>
                  {DEMAND_CATEGORIES.map((c) => (
                    <label key={c.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="category"
                        value={c.value}
                        required
                        defaultChecked={demand.demand_category === c.value}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-slate-800">{c.label}</span>
                        <span className="block text-xs text-slate-500">{c.hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className={primaryButtonClass}>
                  {demand.status === "Open" ? "Categorise" : "Save category"}
                </button>
              </form>
            </section>
          )}

          {canStock && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Issue from stock</h2>
              <p className="mb-4 text-xs text-slate-500">
                Consumable — no approval or vendor needed. Record what was issued; the stock register
                link arrives with the inventory module.
              </p>
              <form action={markStockUpdated.bind(null, demand.id)} className="space-y-3">
                <textarea
                  name="stockNote"
                  rows={3}
                  required
                  placeholder="e.g. 2 toner cartridges issued from the Bhalwal store"
                  aria-label="Stock note"
                  className={inputClass}
                />
                <button type="submit" className={primaryButtonClass}>
                  Record stock issue
                </button>
              </form>
            </section>
          )}

          {canSubmit && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Send for approval</h2>
              {departmentApprovers.length > 0 ? (
                <>
                  <p className="mb-4 text-xs text-slate-500">
                    Goes to the {orgUnits.nameById.get(demand.department_id) ?? "department"} head:{" "}
                    {departmentApprovers.map((a) => a.full_name).join(", ")}.
                  </p>
                  <form action={submitForApproval.bind(null, demand.id)}>
                    <button type="submit" className={primaryButtonClass}>
                      Send for approval
                    </button>
                  </form>
                </>
              ) : (
                <p className="text-sm text-amber-700">
                  The {orgUnits.nameById.get(demand.department_id) ?? "selected"} department has no
                  demand approver yet. An IT admin adds one under Procurement Settings → Department
                  Approvers.
                </p>
              )}
            </section>
          )}

          {demand.status === "Pending Approval" && !canDecide && (
            <section className={`${cardClass} p-6 text-sm text-slate-600`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Awaiting approval</h2>
              {departmentApprovers.length > 0
                ? `With ${departmentApprovers.map((a) => a.full_name).join(", ")}.`
                : "With the department head."}
              {isApprover && isOwner && (
                <p className="mt-2 text-xs text-slate-500">
                  You raised this demand, so another approver of the department has to decide.
                </p>
              )}
            </section>
          )}

          {canDecide && (
            <section className={`${cardClass} border-amber-300 p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Your decision</h2>
              <p className="mb-4 text-xs text-slate-500">
                Requested {demand.quantity} {product?.unit ?? ""} · est. {formatMoney(total)}. The time
                and your name are recorded with the decision.
              </p>
              <form action={decideDemand.bind(null, demand.id)} className="space-y-3">
                <fieldset className="space-y-2">
                  <legend className="sr-only">Decision</legend>
                  {(["Approved", "Partially Approved", "Rejected"] as const).map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm text-slate-800">
                      <input type="radio" name="decision" value={d} required defaultChecked={d === "Approved"} />
                      {d === "Approved" ? `Approve all ${demand.quantity}` : d === "Partially Approved" ? "Approve part" : "Reject"}
                    </label>
                  ))}
                </fieldset>
                <label className="block">
                  <span className={labelClass}>Quantity approved (for “Approve part”)</span>
                  <input
                    type="number"
                    name="approvedQuantity"
                    min={1}
                    max={Math.max(1, demand.quantity - 1)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Comments (required to reject or approve part)</span>
                  <textarea name="comments" rows={3} className={inputClass} />
                </label>
                <button type="submit" className={primaryButtonClass}>
                  Record decision
                </button>
              </form>
            </section>
          )}

          {canRevise && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-1 text-base font-semibold text-slate-900">Revise &amp; resubmit</h2>
              <p className="mb-4 text-xs text-slate-500">
                Change what the approver objected to, then send it for approval again. The rejection
                stays in the history.
              </p>
              <form action={reviseRejectedDemand.bind(null, demand.id)} className="space-y-3">
                <label className="block">
                  <span className={labelClass}>Quantity</span>
                  <input
                    type="number"
                    name="quantity"
                    min={1}
                    max={100000}
                    required
                    defaultValue={demand.quantity}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Justification</span>
                  <textarea
                    name="justification"
                    rows={3}
                    required
                    defaultValue={demand.justification}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>What changed (for the approver)</span>
                  <input name="note" required className={inputClass} />
                </label>
                <button type="submit" className={primaryButtonClass}>
                  Revise
                </button>
              </form>
            </section>
          )}

          {canAssignVendor && <VendorPanel demand={demand} vendors={vendorsRes.data ?? []} />}

          {canReceive && (
            <ReceivingPanel demand={demand} unit={product?.unit ?? ""} isFixedAsset={Boolean(product?.asset_type_id)} />
          )}

          {canClose && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-3 text-base font-semibold text-slate-900">Close demand</h2>
              <form action={closeDemand.bind(null, demand.id)}>
                <button type="submit" className={primaryButtonClass}>
                  Close demand
                </button>
              </form>
            </section>
          )}

          {canCancel && (
            <section className={`${cardClass} p-6`}>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-red-700">Cancel demand</summary>
                <form action={cancelDemand.bind(null, demand.id)} className="mt-3 space-y-3">
                  <textarea
                    name="reason"
                    rows={2}
                    required
                    placeholder="Why is it no longer needed?"
                    aria-label="Reason for cancelling"
                    className={inputClass}
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Cancel demand
                  </button>
                </form>
              </details>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
