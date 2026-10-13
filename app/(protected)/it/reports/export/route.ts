import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { parseWindow, toDateInput } from "@/lib/it/ticket-metrics";
import { buildReport, isReportKind } from "../report-data";

// Same pattern as admin/audit-log/export: a Route Handler is GET-reachable on its own, so it
// checks the permission itself rather than relying on the page that links to it.

function csvEscape(value: string) {
  // Neutralise spreadsheet formula injection (a category or name starting with = + - @).
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(fields: string[]) {
  return fields.map(csvEscape).join(",") + "\r\n";
}

export async function GET(request: NextRequest) {
  const { supabase } = await requirePermission("it.tickets.read");
  const params = request.nextUrl.searchParams;

  const kind = params.get("report") ?? "volume";
  if (!isReportKind(kind)) {
    return new NextResponse("Unknown report", { status: 400 });
  }

  const { from, to } = parseWindow(params.get("from") ?? undefined, params.get("to") ?? undefined);
  const { columns, rows } = await buildReport(supabase, kind, from, to);

  let csv = csvRow(columns);
  for (const row of rows) csv += csvRow(row);

  const lastDay = new Date(to.getTime() - 1);
  const filename = `it-${kind}-report_${toDateInput(from)}_to_${toDateInput(lastDay)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
