import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { fetchOrgUnits } from "@/lib/it/ticket-data";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import { DOCUMENT_BUCKET, formatMoney, INVOICE_STATUS_TONE } from "@/lib/it/procurement";
import type { ItDocument } from "@/types/database";
import { cardClass, Fact, secondaryButtonClass } from "../../../_components/ticket-ui";
import { DocumentLinks } from "../../demands/[id]/document-links";

// Invoice package (BRD §5.5.16): everything Finance needs for one invoice on one page — invoice,
// Delivery Challan, Gate Pass, approval records, GL / cost-center sign-off, payments. Readable by
// procurement staff, invoice approvers and Finance (RLS on it.invoices, javaria_it_0016).

function Check({ ok, optional, label, detail }: { ok: boolean; optional?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          ok ? "bg-emerald-100 text-emerald-700" : optional ? "bg-slate-100 text-slate-400" : "bg-red-100 text-red-700"
        }`}
      >
        {ok ? "✓" : optional ? "–" : "!"}
      </span>
      <span className="text-sm">
        <span className="font-medium text-slate-900">{label}</span>
        <span className="sr-only">{ok ? " — present" : optional ? " — optional, not attached" : " — missing"}</span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </li>
  );
}

export default async function InvoicePackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase.schema("it").from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();

  const [demandRes, receivingRes, vendorRes, approvalsRes, documentsRes, paymentsRes, orgUnits] = await Promise.all([
    supabase.schema("it").from("demands").select("*").eq("id", invoice.demand_id).maybeSingle(),
    supabase.schema("it").from("receiving_records").select("*").eq("id", invoice.receiving_id).maybeSingle(),
    invoice.vendor_id
      ? supabase
          .schema("it")
          .from("vendors")
          .select("vendor_name, contact_person, contact_no, email, address, tax_number")
          .eq("id", invoice.vendor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.schema("it").from("demand_approvals").select("*").eq("demand_id", invoice.demand_id).order("decided_at"),
    supabase.schema("it").from("documents").select("*").eq("demand_id", invoice.demand_id).order("uploaded_at"),
    supabase.schema("it").from("payments").select("*").eq("invoice_id", invoice.id).order("payment_date"),
    fetchOrgUnits(supabase),
  ]);
  const demand = demandRes.data;
  const receiving = receivingRes.data;
  const vendor = vendorRes.data;
  const approvals = approvalsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const allDocs = (documentsRes.data ?? []) as ItDocument[];
  const { data: product } = demand
    ? await supabase.schema("it").from("products").select("product_name, unit").eq("id", demand.product_id).maybeSingle()
    : { data: null };

  const invoiceDocs = allDocs.filter((d) => d.entity_type === "invoice" && d.entity_id === invoice.id);
  const receivingDocs = allDocs.filter((d) => d.entity_type === "receiving" && d.entity_id === invoice.receiving_id);
  const paymentDocs = allDocs.filter((d) => d.entity_type === "payment" && payments.some((p) => p.id === d.entity_id));
  const packageDocs = [...invoiceDocs, ...receivingDocs, ...paymentDocs];

  const paths = packageDocs.map((d) => d.storage_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrls(paths, 600)
    : { data: [] };
  const urls = new Map<string, string>();
  for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);

  const peopleIds = [
    demand?.requested_by_person_id,
    receiving?.received_by_person_id,
    invoice.approved_by,
    invoice.created_by,
    invoice.flag_cleared_by,
    ...approvals.map((a) => a.approver_person_id),
  ].filter((v): v is string => Boolean(v));
  const { data: people } = peopleIds.length
    ? await supabase.schema("it").rpc("demand_person_names", { p_person_ids: [...new Set(peopleIds)] })
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.person_id, p.full_name]));
  const who = (pid: string | null | undefined) => (pid && names.get(pid)) || "—";

  const hasInvoiceFile = invoiceDocs.some((d) => d.doc_type === "Invoice");
  const hasDc = Boolean(receiving?.delivery_challan_no) || receivingDocs.some((d) => d.doc_type === "Delivery Challan");
  const hasGatePass = Boolean(receiving?.gate_pass_no) || receivingDocs.some((d) => d.doc_type === "Gate Pass");
  const demandDecision = approvals.at(-1);
  const hasSignOff = invoiceDocs.some((d) => d.doc_type === "Approval");
  const unpaid = Number(invoice.invoice_amount) - Number(invoice.paid_amount);

  return (
    <div className="py-6">
      <PageHeader
        title={`Invoice package · ${invoice.invoice_number}`}
        description={`${vendor?.vendor_name ?? "Vendor"} · demand ${demand?.demand_number ?? ""} · ${formatMoney(invoice.invoice_amount)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/it/procurement/demands/${invoice.demand_id}`} className={secondaryButtonClass}>
              Open demand
            </Link>
            <Link href="/it/procurement/finance" className={secondaryButtonClass}>
              Finance
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className={`${cardClass} p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Invoice</h2>
              <StatusPill label={invoice.status} tone={INVOICE_STATUS_TONE[invoice.status]} />
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Invoice no. / date">
                {invoice.invoice_number} · {formatDate(invoice.invoice_date)}
              </Fact>
              <Fact label="Total (incl. tax)">{formatMoney(invoice.invoice_amount)}</Fact>
              <Fact label="Tax">{formatMoney(invoice.tax_amount)}</Fact>
              <Fact label="Quantity billed">
                {invoice.invoice_quantity} {product?.unit ?? ""}
              </Fact>
              <Fact label="Expected (before tax)">{formatMoney(invoice.expected_amount)}</Fact>
              <Fact label="GL / cost center">{invoice.cost_center ?? "—"}</Fact>
              <Fact label="Check">
                {invoice.quantity_mismatch || invoice.amount_mismatch
                  ? invoice.flag_clear_note
                    ? `Mismatch accepted by ${who(invoice.flag_cleared_by)}: ${invoice.flag_clear_note}`
                    : `Mismatch: ${invoice.verification_notes ?? ""}`
                  : "Matches the delivery"}
              </Fact>
              <Fact label="Logged by">{who(invoice.created_by)}</Fact>
              <Fact label="Approved">
                {invoice.approved_at ? `${who(invoice.approved_by)} · ${formatDateTime(invoice.approved_at)}` : "—"}
              </Fact>
            </dl>
            <DocumentLinks documents={invoiceDocs} urls={urls} />
          </section>

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Delivery</h2>
            {receiving ? (
              <>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Fact label="Receipt">{receiving.receiving_number}</Fact>
                  <Fact label="Received">
                    {formatDate(receiving.received_date)} · {who(receiving.received_by_person_id)}
                  </Fact>
                  <Fact label="Delivered / accepted">
                    {receiving.received_quantity} / {receiving.accepted_quantity} {product?.unit ?? ""}
                  </Fact>
                  <Fact label="Condition">{receiving.condition}</Fact>
                  <Fact label="Delivery Challan no.">{receiving.delivery_challan_no ?? "—"}</Fact>
                  <Fact label="Inward Gate Pass no.">{receiving.gate_pass_no ?? "—"}</Fact>
                </dl>
                {receiving.remarks && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{receiving.remarks}</p>}
                <DocumentLinks documents={receivingDocs} urls={urls} />
              </>
            ) : (
              <p className="text-sm text-slate-400">Delivery not found.</p>
            )}
          </section>

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">Demand &amp; approval</h2>
            {demand && (
              <dl className="grid gap-4 sm:grid-cols-3">
                <Fact label="Demand">{demand.demand_number}</Fact>
                <Fact label="Product">{product?.product_name ?? "—"}</Fact>
                <Fact label="Requested / approved">
                  {demand.quantity} / {demand.approved_quantity ?? "—"}
                </Fact>
                <Fact label="Department">{orgUnits.nameById.get(demand.department_id) ?? "—"}</Fact>
                <Fact label="Site">{orgUnits.nameById.get(demand.site_id) ?? "—"}</Fact>
                <Fact label="Requested by">{who(demand.requested_by_person_id)}</Fact>
                <Fact label="Agreed unit price">{formatMoney(demand.agreed_unit_price ?? demand.estimated_unit_price)}</Fact>
              </dl>
            )}
            {approvals.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {approvals.map((a) => (
                  <li key={a.id} className="text-slate-700">
                    <span className="font-medium">{a.decision}</span> ({a.approved_quantity}) by {who(a.approver_person_id)} ·{" "}
                    {formatDateTime(a.decided_at)}
                    {a.comments && <span className="text-slate-500"> — {a.comments}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${cardClass} p-6`}>
            <h2 className="mb-1 text-base font-semibold text-slate-900">Payments</h2>
            <p className="mb-4 text-sm text-slate-500">
              Paid {formatMoney(invoice.paid_amount)} of {formatMoney(invoice.invoice_amount)}
              {unpaid > 0 && ` · ${formatMoney(unpaid)} unpaid`}
              {invoice.finance_due_on && invoice.status !== "Paid" && ` · Finance due ${formatDate(invoice.finance_due_on)}`}
            </p>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-400">No payments yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-slate-700">
                {payments.map((p) => (
                  <li key={p.id}>
                    {p.payment_number} · {formatMoney(p.paid_amount)} · {p.payment_method} · ref {p.payment_reference} ·{" "}
                    {formatDate(p.payment_date)}
                    {p.vendor_notified_at && <span className="text-slate-500"> · vendor emailed</span>}
                  </li>
                ))}
              </ul>
            )}
            <DocumentLinks documents={paymentDocs} urls={urls} />
          </section>
        </div>

        <aside className="space-y-6">
          <section className={`${cardClass} p-6`}>
            <h2 className="mb-2 text-base font-semibold text-slate-900">Package contents</h2>
            <ul className="divide-y divide-slate-100">
              <Check ok={hasInvoiceFile} label="Invoice" detail={hasInvoiceFile ? "File attached" : "Invoice file not uploaded"} />
              <Check
                ok={hasDc}
                optional
                label="Delivery Challan"
                detail={hasDc ? (receiving?.delivery_challan_no ? `No. ${receiving.delivery_challan_no}` : "Picture attached") : "Not provided (optional)"}
              />
              <Check
                ok={hasGatePass}
                label="Inward Gate Pass"
                detail={hasGatePass ? (receiving?.gate_pass_no ? `No. ${receiving.gate_pass_no}` : "Picture attached") : "Number or picture needed"}
              />
              <Check
                ok={Boolean(demandDecision && demandDecision.decision !== "Rejected")}
                label="Demand approval"
                detail={demandDecision ? `${demandDecision.decision} by ${who(demandDecision.approver_person_id)}` : "No approval record"}
              />
              <Check
                ok={Boolean(invoice.approved_at)}
                label="Invoice approval"
                detail={invoice.approved_at ? `By ${who(invoice.approved_by)}` : "Not approved yet"}
              />
              <Check
                ok={hasSignOff}
                optional
                label="GL / cost center sign-off"
                detail={hasSignOff ? "Sign-off attached" : invoice.cost_center ? `Cost center ${invoice.cost_center}, no sign-off file` : "Not attached"}
              />
            </ul>
          </section>

          {vendor && (
            <section className={`${cardClass} p-6`}>
              <h2 className="mb-2 text-base font-semibold text-slate-900">Vendor</h2>
              <p className="text-sm font-medium text-slate-900">{vendor.vendor_name}</p>
              <p className="text-sm text-slate-600">
                {[vendor.contact_person, vendor.contact_no, vendor.email].filter(Boolean).join(" · ") || "No contact details"}
              </p>
              {vendor.tax_number && <p className="text-xs text-slate-500">Tax no. {vendor.tax_number}</p>}
              {vendor.address && <p className="text-xs text-slate-500">{vendor.address}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
