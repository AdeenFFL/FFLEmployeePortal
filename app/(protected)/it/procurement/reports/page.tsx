import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { hasItPermission } from "@/lib/it/ticket-data";
import { parseWindow, toDateInput } from "@/lib/it/ticket-metrics";
import { formatMoney } from "@/lib/it/procurement";
import {
  buildProcurementReport,
  isProcurementReportKind,
  PROCUREMENT_REPORT_KEYS,
  PROCUREMENT_REPORTS,
  procurementKpis,
  type ProcurementReportKind,
} from "@/lib/it/procurement-reports";
import { BarList, StatTile } from "../../_components/charts";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

// PRC-09 Procurement reports with CSV export (09-it-procurement-plan.md Phase 7). For site /
// all-sites procurement staff and Finance; rows follow RLS (a site's staff see their sites).
export default async function ProcurementReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const allowed = await Promise.all(PROCUREMENT_REPORT_KEYS.map((k) => hasItPermission(supabase, k)));
  if (!allowed.some(Boolean)) notFound();

  const kind: ProcurementReportKind = isProcurementReportKind(params.report) ? params.report : "register";
  const { from, to } = parseWindow(params.from, params.to);
  const fromInput = toDateInput(from);
  const toInput = toDateInput(new Date(to.getTime() - 1));

  const [{ columns, rows }, kpis, { data: vendors }] = await Promise.all([
    buildProcurementReport(supabase, kind, from, to),
    procurementKpis(supabase, from, to),
    supabase.schema("it").from("vendors").select("id, vendor_name"),
  ]);
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.vendor_name]));
  const spendRows = kpis.spendByVendorId.slice(0, 8).map(([id, amount]) => {
    const label = vendorName.get(id) ?? "—";
    return {
      label,
      value: Math.round(amount),
      tooltip: `${label}: ${formatMoney(amount)} (${Math.round((amount / Math.max(1, kpis.spent)) * 100)}% of spend)`,
    };
  });

  const query = (report: ProcurementReportKind) => `report=${report}&from=${fromInput}&to=${toInput}`;

  return (
    <div className="py-6">
      <PageHeader
        title="Procurement Reports"
        description="Demands, cycle time, spend, receiving shortfalls and invoices at Finance — exportable as CSV."
        action={
          <Link href="/it/procurement/demands" className={secondaryButtonClass}>
            Demand queue
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Spent in period"
          value={formatMoney(kpis.spent)}
          context={`${kpis.raised} demands raised in period`}
        />
        <StatTile
          label="Awaiting approval"
          value={kpis.awaitingApproval.toLocaleString()}
          context={`${kpis.toRoute} to categorise / send`}
        />
        <StatTile
          label="Awaiting delivery"
          value={kpis.awaitingDelivery.toLocaleString()}
          alert={kpis.lateDeliveries > 0 && `${kpis.lateDeliveries} past expected date`}
          context="Approved, not fully received"
        />
        <StatTile
          label="With Finance"
          value={formatMoney(kpis.unpaidAtFinance)}
          alert={kpis.overdueAtFinance > 0 && `${kpis.overdueAtFinance} overdue (SLA)`}
          context={`${kpis.atFinance} invoice${kpis.atFinance === 1 ? "" : "s"} unpaid`}
        />
      </div>

      <section className={`${cardClass} mb-6 p-6`}>
        <h2 className="text-base font-semibold text-slate-900">Spend by vendor</h2>
        <p className="mb-4 text-sm text-slate-500">
          Payments {fromInput} to {toInput}, top vendors (Rs)
        </p>
        <BarList
          title={`Spend by vendor, ${fromInput} to ${toInput}`}
          rows={spendRows}
          valueHeader="Paid (Rs)"
          emptyText="No payments in this period."
        />
      </section>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Report">
        {(Object.keys(PROCUREMENT_REPORTS) as ProcurementReportKind[]).map((k) => (
          <Link
            key={k}
            role="tab"
            aria-selected={k === kind}
            href={`/it/procurement/reports?${query(k)}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              k === kind ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {PROCUREMENT_REPORTS[k].title}
          </Link>
        ))}
      </div>

      <form method="get" className={`${cardClass} mb-6 flex flex-wrap items-end gap-3 p-4`}>
        <input type="hidden" name="report" value={kind} />
        <label>
          <span className={labelClass}>From</span>
          <input type="date" name="from" defaultValue={fromInput} className={inputClass} />
        </label>
        <label>
          <span className={labelClass}>To</span>
          <input type="date" name="to" defaultValue={toInput} className={inputClass} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Apply
        </button>
        {/* A plain link to the Route Handler: the browser downloads the CSV itself. */}
        <a href={`/it/procurement/reports/export?${query(kind)}`} className={`${secondaryButtonClass} ml-auto`}>
          Export CSV
        </a>
      </form>

      <section className={cardClass}>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{PROCUREMENT_REPORTS[kind].title}</h2>
          <p className="text-sm text-slate-500">{PROCUREMENT_REPORTS[kind].description}</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Nothing to report.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-4 py-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map((row, i) => (
                  <tr key={i} className={row[0] === "Average" ? "bg-slate-50 font-medium" : "hover:bg-slate-50"}>
                    {row.map((cell, j) => (
                      <td key={j} className={`whitespace-nowrap px-4 py-3 ${j === 0 ? "text-slate-800" : "text-slate-600"}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
