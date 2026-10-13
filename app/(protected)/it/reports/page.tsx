import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { parseWindow, toDateInput } from "@/lib/it/ticket-metrics";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../_components/ticket-ui";
import { buildReport, isReportKind, REPORTS, type ReportKind } from "./report-data";

// ITSM-02 — IT reports with CSV export (BRD §5.3.17, §7.12, §7.13). Gated by it.tickets.read.
export default async function ItReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const kind: ReportKind = isReportKind(params.report) ? params.report : "volume";
  const { from, to } = parseWindow(params.from, params.to);
  const fromInput = toDateInput(from);
  const toInput = toDateInput(new Date(to.getTime() - 1));

  const supabase = await createClient();
  const { columns, rows } = await buildReport(supabase, kind, from, to);

  const query = (report: ReportKind) =>
    `report=${report}&from=${fromInput}&to=${toInput}`;

  return (
    <div className="py-6">
      <PageHeader
        title="IT Reports"
        description="Ticket volume, SLA compliance and technician productivity, exportable as CSV."
        action={
          <Link href="/it/dashboard" className={secondaryButtonClass}>
            Dashboard
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Report">
        {(Object.keys(REPORTS) as ReportKind[]).map((k) => (
          <Link
            key={k}
            role="tab"
            aria-selected={k === kind}
            href={`/it/reports?${query(k)}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              k === kind
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {REPORTS[k].title}
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
        <a href={`/it/reports/export?${query(kind)}`} className={`${secondaryButtonClass} ml-auto`}>
          Export CSV
        </a>
      </form>

      <section className={cardClass}>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{REPORTS[kind].title}</h2>
          <p className="text-sm text-slate-500">{REPORTS[kind].description}</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No tickets in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-6 py-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-6 py-3 ${
                          cell === "Breached"
                            ? "font-medium text-red-600"
                            : cell === "Met"
                              ? "font-medium text-emerald-700"
                              : j === 0
                                ? "text-slate-800"
                                : "text-slate-600"
                        }`}
                      >
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
