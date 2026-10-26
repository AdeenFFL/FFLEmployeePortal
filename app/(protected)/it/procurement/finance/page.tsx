import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { formatDate } from "@/lib/it/tickets";
import { formatMoney, INVOICE_STATUS_TONE, todayIso } from "@/lib/it/procurement";
import type { ItInvoiceStatus } from "@/types/database";
import { cardClass, FormMessage } from "../../_components/ticket-ui";
import { PaymentBlock } from "../demands/[id]/payment-panel";

const TABS: { key: string; label: string; statuses: ItInvoiceStatus[] }[] = [
  { key: "confirm", label: "To confirm", statuses: ["Sent to Finance"] },
  { key: "pay", label: "To pay", statuses: ["Confirmed"] },
  { key: "paid", label: "Paid", statuses: ["Paid"] },
];

// PRC-07 Finance inbox (BRD §5.5.17–5.5.19): invoice packages sent to Finance, SLA ageing,
// confirm / return, record payments + vendor reference. Gated by it.payments.update; Finance also
// needs it.demands.read_all to see every site's packages (javaria_it_0015).
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.find((t) => t.key === params.tab) ?? TABS[0];
  const today = todayIso();
  const supabase = await createClient();

  const [listRes, openRes, orgUnits] = await Promise.all([
    supabase
      .schema("it")
      .from("invoices")
      .select("*")
      .in("status", tab.statuses)
      .order(tab.key === "paid" ? "paid_at" : "sent_to_finance_at", { ascending: tab.key !== "paid" })
      .limit(tab.key === "paid" ? 50 : 200),
    supabase
      .schema("it")
      .from("invoices")
      .select("status, invoice_amount, paid_amount, finance_due_on")
      .in("status", ["Sent to Finance", "Confirmed"]),
    fetchOrgUnits(supabase),
  ]);
  const invoices = checked(listRes).data ?? [];
  const open = openRes.data ?? [];

  const demandIds = [...new Set(invoices.map((i) => i.demand_id))];
  const vendorIds = [...new Set(invoices.map((i) => i.vendor_id).filter((v): v is string => Boolean(v)))];
  const invoiceIds = invoices.map((i) => i.id);
  const [demandsRes, vendorsRes, paymentsRes] = await Promise.all([
    demandIds.length
      ? supabase.schema("it").from("demands").select("id, demand_number, product_id").in("id", demandIds)
      : Promise.resolve({ data: [] as { id: string; demand_number: string; product_id: string }[] }),
    vendorIds.length
      ? supabase.schema("it").from("vendors").select("id, vendor_name, email").in("id", vendorIds)
      : Promise.resolve({ data: [] as { id: string; vendor_name: string; email: string | null }[] }),
    invoiceIds.length
      ? supabase.schema("it").from("payments").select("*").in("invoice_id", invoiceIds).order("payment_date")
      : Promise.resolve({ data: [] }),
  ]);
  const demandById = new Map((demandsRes.data ?? []).map((d) => [d.id, d]));
  const vendorById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v]));
  const payments = paymentsRes.data ?? [];
  const productIds = [...new Set((demandsRes.data ?? []).map((d) => d.product_id))];
  const { data: products } = productIds.length
    ? await supabase.schema("it").from("products").select("id, product_name").in("id", productIds)
    : { data: [] };
  const productName = new Map((products ?? []).map((p) => [p.id, p.product_name]));

  const kpis = [
    { label: "To confirm", value: String(open.filter((i) => i.status === "Sent to Finance").length) },
    { label: "To pay", value: String(open.filter((i) => i.status === "Confirmed").length) },
    {
      label: "Overdue (SLA)",
      value: String(open.filter((i) => i.finance_due_on !== null && i.finance_due_on < today).length),
    },
    {
      label: "Unpaid with Finance",
      value: formatMoney(open.reduce((sum, i) => sum + Number(i.invoice_amount) - Number(i.paid_amount), 0)),
    },
  ];

  return (
    <div className="py-6">
      <PageHeader
        title="Finance"
        description="Invoice packages from IT procurement: confirm receipt, record payments, send the reference to the vendor."
      />
      <FormMessage error={params.error} notice={params.notice} />

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={`${cardClass} px-5 py-4`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{k.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/it/procurement/finance?tab=${t.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              t.key === tab.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <p className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
          {tab.key === "paid" ? "No paid invoices yet." : "Nothing here right now."}
        </p>
      ) : (
        <ul className="space-y-4">
          {invoices.map((inv) => {
            const demand = demandById.get(inv.demand_id);
            const vendor = inv.vendor_id ? vendorById.get(inv.vendor_id) : undefined;
            const overdue = inv.status !== "Paid" && inv.finance_due_on !== null && inv.finance_due_on < today;
            return (
              <li key={inv.id} className={`${cardClass} p-5 ${overdue ? "border-red-200" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      Invoice {inv.invoice_number}
                      <StatusPill label={inv.status} tone={INVOICE_STATUS_TONE[inv.status]} />
                    </p>
                    <p className="text-sm text-slate-600">
                      {vendor?.vendor_name ?? "Vendor"} · {demand?.demand_number ?? "Demand"} ·{" "}
                      {productName.get(demand?.product_id ?? "") ?? ""} · {orgUnits.nameById.get(inv.site_id ?? "") ?? ""}
                    </p>
                    <p className="text-xs text-slate-400">
                      Invoice date {formatDate(inv.invoice_date)}
                      {inv.sent_to_finance_at && ` · received ${formatDate(inv.sent_to_finance_at)}`}
                      {inv.paid_at && ` · paid ${formatDate(inv.paid_at)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-slate-900">{formatMoney(inv.invoice_amount)}</p>
                    <Link
                      href={`/it/procurement/demands/${inv.demand_id}`}
                      className="text-sm font-medium text-blue-700 hover:underline"
                    >
                      Open package →
                    </Link>
                  </div>
                </div>
                <PaymentBlock
                  demandId={inv.demand_id}
                  invoice={inv}
                  payments={payments.filter((p) => p.invoice_id === inv.id)}
                  documents={[]}
                  urls={new Map()}
                  isFinance
                  vendorHasEmail={Boolean(vendor?.email)}
                  back="finance"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
