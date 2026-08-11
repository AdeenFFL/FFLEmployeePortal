import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type AuditLogFilters = {
  q?: string;
  from?: string; // YYYY-MM-DD, from a native <input type="date">
  to?: string;
  module?: string;
  user?: string;
};

// Shared by app/(protected)/admin/audit-log/page.tsx and its CSV export route, so the filter
// logic can't drift between the two.
export function applyAuditLogFilters(
  supabase: SupabaseServerClient,
  filters: AuditLogFilters,
) {
  let query = supabase.from("audit_log").select("*", { count: "exact" });

  const q = filters.q?.trim().replace(/[,()]/g, "");
  if (q) query = query.or(`actor_label.ilike.%${q}%,details.ilike.%${q}%`);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
  if (filters.module) query = query.eq("module", filters.module);
  if (filters.user) query = query.eq("actor_label", filters.user);

  return query.order("created_at", { ascending: false });
}
