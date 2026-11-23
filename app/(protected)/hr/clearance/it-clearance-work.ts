import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadSignerSetup, mySlotsForCase, myScopes } from "./signer-work";
import { cleanSlotLabel } from "../clearance-requests/clearance-view";

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

// ---------------------------------------------------------------------------------------------
// Every clearance task of mine, for My Tasks and its sidebar count: the parts I sign (any part:
// Admin, Store, Accounts, Department Head, HR, IT), and the handovers I must confirm as the
// line manager. Same rules as the signer inbox (signer-work.ts) and My Requests.

export type SigningTask = {
  key: string;
  caseId: string;
  caseNumber: string;
  employeeName: string;
  employeeCode: string | null;
  partLabel: string;
  href: string;
  // Open: when the case was created. Done: when I signed.
  sortAt: string;
  done: boolean;
};

// Open: the parts I sign on cases now In Clearance that are not signed or skipped yet.
// Done: the parts I signed (most recent 50).
export async function loadMySigningTasks(
  supabase: Client,
  personId: string,
  show: "open" | "done",
): Promise<SigningTask[]> {
  const hr = supabase.schema("hr");
  if (show === "done") {
    const { data } = await hr
      .from("clearance_signoffs")
      .select("case_id, slot_key, signed_at, clearance_cases(case_number, employee_name, employee_code), clearance_slots(label)")
      .eq("signed_by_person_id", personId)
      .order("signed_at", { ascending: false })
      .limit(50);
    return (data ?? []).map((s) => {
      const c = Array.isArray(s.clearance_cases) ? s.clearance_cases[0] : s.clearance_cases;
      const slot = Array.isArray(s.clearance_slots) ? s.clearance_slots[0] : s.clearance_slots;
      return {
        key: `${s.case_id}:${s.slot_key}`,
        caseId: s.case_id,
        caseNumber: c?.case_number ?? "Clearance",
        employeeName: c?.employee_name ?? "",
        employeeCode: c?.employee_code ?? null,
        partLabel: cleanSlotLabel(slot?.label ?? s.slot_key),
        href: `/hr/clearance/${s.case_id}/${s.slot_key}`,
        sortAt: s.signed_at,
        done: true,
      };
    });
  }

  const setup = await loadSignerSetup(supabase, personId);
  if (setup.error) return [];
  const { siteIds, departmentIds } = myScopes(setup.signers, setup.slots);
  const scopeFilter = [
    siteIds.length ? `site_id.in.(${siteIds.join(",")})` : null,
    departmentIds.length ? `department_id.in.(${departmentIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");
  if (!scopeFilter) return [];

  const { data: cases } = await hr
    .from("clearance_cases")
    .select("id, case_number, employee_name, employee_code, site_id, department_id, created_at")
    .eq("status", "In Clearance")
    .neq("person_id", personId)
    .or(scopeFilter)
    .order("created_at", { ascending: false });
  if (!cases?.length) return [];

  const ids = cases.map((c) => c.id);
  const [{ data: signoffs }, { data: skips }] = await Promise.all([
    hr.from("clearance_signoffs").select("case_id, slot_key").in("case_id", ids),
    hr.from("clearance_skips").select("case_id, slot_key").in("case_id", ids),
  ]);
  const closed = new Set([...(signoffs ?? []), ...(skips ?? [])].map((s) => `${s.case_id}:${s.slot_key}`));

  return cases.flatMap((c) =>
    mySlotsForCase(c, setup.signers, setup.slots)
      .filter((s) => !closed.has(`${c.id}:${s.slot_key}`))
      .map((s) => ({
        key: `${c.id}:${s.slot_key}`,
        caseId: c.id,
        caseNumber: c.case_number,
        employeeName: c.employee_name,
        employeeCode: c.employee_code,
        partLabel: cleanSlotLabel(s.label),
        href: `/hr/clearance/${c.id}/${s.slot_key}`,
        sortAt: c.created_at,
        done: false,
      })),
  );
}

export type HandoverTask = {
  caseId: string;
  caseNumber: string;
  employeeName: string;
  employeeCode: string | null;
  confirmedAt: string | null;
  caseStatus: string;
  // Still to confirm: the case is In Clearance and not confirmed yet.
  open: boolean;
};

// The leaving employees HR chose me as the line manager for (my_handover_requests).
export async function loadMyHandovers(supabase: Client): Promise<HandoverTask[]> {
  const { data, error } = await supabase.schema("hr").rpc("my_handover_requests");
  if (error) return [];
  return (data ?? []).map((h) => ({
    caseId: h.case_id,
    caseNumber: h.case_number,
    employeeName: h.employee_name,
    employeeCode: h.employee_code,
    confirmedAt: h.confirmed_at,
    caseStatus: h.case_status,
    open: h.case_status === "In Clearance" && !h.confirmed_at,
  }));
}

export const HANDOVERS_HREF = "/requests";

// The number on "My Tasks" in the sidebar: everything still to do — IT tickets, ticket tasks and
// onboarding tasks assigned to me, the clearance parts I sign, my clearance tasks with something
// left, and handovers to confirm. Head-only counts where possible; any part that fails counts 0.
export async function countMyOpenWork(supabase: Client): Promise<number> {
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return 0;
  const it = supabase.schema("it");
  const [tickets, ticketTasks, checklist, signing, groups, handovers] = await Promise.all([
    it
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_person_id", personId)
      .not("status", "in", "(Resolved,Closed)"),
    it
      .from("ticket_tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_person_id", personId)
      .in("status", ["Pending", "In Progress"]),
    it
      .from("checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_person_id", personId)
      .in("status", ["Pending", "In Progress"]),
    loadMySigningTasks(supabase, personId, "open"),
    loadMyClearanceTaskGroups(supabase),
    loadMyHandovers(supabase),
  ]);
  const headCount = (r: { count: number | null; error: unknown }) => (r.error ? 0 : (r.count ?? 0));
  return (
    headCount(tickets) +
    headCount(ticketTasks) +
    headCount(checklist) +
    signing.length +
    groups.filter((g) => g.open && g.left > 0).length +
    handovers.filter((h) => h.open).length
  );
}
