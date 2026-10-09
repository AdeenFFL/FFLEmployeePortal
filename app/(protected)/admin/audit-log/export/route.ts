import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { applyAuditLogFilters } from "@/lib/admin/audit-query";

// Route Handlers are independently GET-reachable regardless of which page linked to them —
// same defense-in-depth rationale requirePermission()'s own doc comment gives for Server Actions.
const EXPORT_ROW_CAP = 5000;

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: string[]) {
  return fields.map(csvEscape).join(",") + "\r\n";
}

export async function GET(request: NextRequest) {
  await requirePermission("route:/admin/audit-log");
  const supabase = await createClient();
  const params = request.nextUrl.searchParams;

  const { data } = await applyAuditLogFilters(supabase, {
    q: params.get("q") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    module: params.get("module") ?? undefined,
    user: params.get("user") ?? undefined,
  }).range(0, EXPORT_ROW_CAP - 1);

  let csv = csvRow(["Timestamp", "User", "Module", "Action", "Details"]);
  for (const row of data ?? []) {
    csv += csvRow([
      new Date(row.created_at).toLocaleString(),
      row.actor_label,
      row.module,
      row.action,
      row.details,
    ]);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-export.csv"`,
    },
  });
}
