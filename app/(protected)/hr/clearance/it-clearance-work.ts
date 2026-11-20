import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadSignerSetup } from "./signer-work";

// "My IT clearance work", shared by the IT screens (My Tasks, Requests, Dashboard) so they all
// follow the same rules. Nothing new in the database: the clearance tables stay where they are
// and these only read them (RLS lets an IT signer read the cases at their sites, and the
// my_clearance_* functions return only my own tasks).

type Client = SupabaseClient<Database>;

const IT_SLOT = "it";

export type ItPartState = "Waiting for IT" | "IT signed" | "IT skipped";

export type ItSignerCase = {
  id: string;
  case_number: string;
  employee_name: string;
  employee_code: string | null;
  site_id: string | null;
  status: string;
  created_at: string;
  // Only while the case is In Clearance; null before HR starts it and once it is closed.
  itState: ItPartState | null;
  // The IT part of the case, where the IT signer works.
  href: string;
};

// The cases at the sites where I am the IT signer (never my own). activeOnly: Submitted and
// In Clearance only. Newest first.
export async function loadItSignerCases(
  supabase: Client,
  personId: string,
  options: { activeOnly: boolean; siteId?: string; search?: string; limit?: number },
): Promise<ItSignerCase[]> {
  const setup = await loadSignerSetup(supabase, personId);
  const itActive = setup.slots.some((s) => s.slot_key === IT_SLOT);
  const siteIds = [
    ...new Set(
      setup.signers.flatMap((g) => (g.slot_key === IT_SLOT && g.site_id ? [g.site_id] : [])),
    ),
  ].filter((id) => !options.siteId || id === options.siteId);
  if (setup.error || !itActive || siteIds.length === 0) return [];

  const hr = supabase.schema("hr");
  let query = hr
    .from("clearance_cases")
    .select("id, case_number, employee_name, employee_code, site_id, status, created_at")
    .in("site_id", siteIds)
    .neq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);
  if (options.activeOnly) query = query.in("status", ["Submitted", "In Clearance"]);
  const search = (options.search ?? "").replace(/[,()*%]/g, " ").trim();
  if (search) {
    query = query.or(
      `case_number.ilike.%${search}%,employee_name.ilike.%${search}%,employee_code.ilike.%${search}%`,
    );
  }
  const { data: cases, error } = await query;
  if (error || !cases?.length) return [];

  const ids = cases.map((c) => c.id);
  const [{ data: signoffs }, { data: skips }] = await Promise.all([
    hr.from("clearance_signoffs").select("case_id").eq("slot_key", IT_SLOT).in("case_id", ids),
    hr.from("clearance_skips").select("case_id").eq("slot_key", IT_SLOT).in("case_id", ids),
  ]);
  const signed = new Set((signoffs ?? []).map((s) => s.case_id));
  const skipped = new Set((skips ?? []).map((s) => s.case_id));

  return cases.map((c) => ({
    ...c,
    itState:
      c.status !== "In Clearance"
        ? null
        : signed.has(c.id)
          ? "IT signed"
          : skipped.has(c.id)
            ? "IT skipped"
            : "Waiting for IT",
    href: `/hr/clearance/${c.id}/${IT_SLOT}`,
  }));
}

export type ClearanceTaskGroup = {
  caseId: string;
  caseNumber: string;
  employeeName: string;
  employeeCode: string | null;
  caseStatus: string;
  partLocked: boolean;
  // Still workable: the case is In Clearance and the IT part is not signed yet.
  open: boolean;
  left: number;
  total: number;
  latestAssignedAt: string;
};

// The clearance lines and asset returns the IT Team Lead handed to me, one entry per case,
// newest assignment first.
export async function loadMyClearanceTaskGroups(supabase: Client): Promise<ClearanceTaskGroup[]> {
  const hr = supabase.schema("hr");
  const [lines, assets] = await Promise.all([
    hr.rpc("my_clearance_tasks"),
    hr.rpc("my_clearance_asset_tasks"),
  ]);
  const groups = new Map<string, ClearanceTaskGroup>();
  const groupFor = (t: {
    case_id: string;
    case_number: string;
    employee_name: string;
    employee_code: string | null;
    case_status: string;
    part_locked: boolean;
  }) => {
    let g = groups.get(t.case_id);
    if (!g) {
      g = {
        caseId: t.case_id,
        caseNumber: t.case_number,
        employeeName: t.employee_name,
        employeeCode: t.employee_code,
        caseStatus: t.case_status,
        partLocked: t.part_locked,
        open: t.case_status === "In Clearance" && !t.part_locked,
        left: 0,
        total: 0,
        latestAssignedAt: "",
      };
      groups.set(t.case_id, g);
    }
    return g;
  };
  const count = (g: ClearanceTaskGroup, done: boolean, assignedAt: string) => {
    g.total += 1;
    if (!done) g.left += 1;
    if (assignedAt > g.latestAssignedAt) g.latestAssignedAt = assignedAt;
  };
  for (const t of lines.error ? [] : (lines.data ?? [])) count(groupFor(t), Boolean(t.outcome), t.assigned_at);
  for (const t of assets.error ? [] : (assets.data ?? [])) count(groupFor(t), t.returned, t.assigned_at);
  return [...groups.values()].sort((a, b) => b.latestAssignedAt.localeCompare(a.latestAssignedAt));
}

export const CLEARANCE_TASKS_HREF = "/hr/clearance/tasks";
