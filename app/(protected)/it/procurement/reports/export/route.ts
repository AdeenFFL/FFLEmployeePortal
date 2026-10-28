import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/require-user";
import { hasItPermission } from "@/lib/it/ticket-data";
import { parseWindow, toDateInput } from "@/lib/it/ticket-metrics";
import {
  buildProcurementReport,
  isProcurementReportKind,
  PROCUREMENT_REPORT_KEYS,
} from "@/lib/it/procurement-reports";

// Same pattern as /it/reports/export: a Route Handler is GET-reachable on its own, so it checks
// access itself (any of the procurement report keys; rows follow RLS).

function csvEscape(value: string) {
  // Neutralise spreadsheet formula injection (a name starting with = + - @).
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(fields: string[]) {
  return fields.map(csvEscape).join(",") + "\r\n";
}

export async function GET(request: NextRequest) {
  const { supabase } = await requireActiveUser();
  const allowed = await Promise.all(PROCUREMENT_REPORT_KEYS.map((k) => hasItPermission(supabase, k)));
  if (!allowed.some(Boolean)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const kind = params.get("report") ?? "register";
  if (!isProcurementReportKind(kind)) {
    return new NextResponse("Unknown report", { status: 400 });
  }

  const { from, to } = parseWindow(params.get("from") ?? undefined, params.get("to") ?? undefined);
  const { columns, rows } = await buildProcurementReport(supabase, kind, from, to);

  // Money cells are formatted "Rs 1,234.00" — keep them, they're what users read on screen.
  let csv = "﻿" + csvRow(columns); // BOM so Excel reads UTF-8 (the — dash)
  for (const row of rows) csv += csvRow(row);

  const lastDay = new Date(to.getTime() - 1);
  const filename = `it-procurement-${kind}_${toDateInput(from)}_to_${toDateInput(lastDay)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
