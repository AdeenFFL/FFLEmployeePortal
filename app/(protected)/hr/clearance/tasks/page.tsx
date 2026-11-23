import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { TaskProgressSummary, type TaskBallState } from "@/components/task-progress";
import {
  STATUS_TONE,
  daysLeftText,
  formatDay,
  formatTimestamp,
  karachiToday,
} from "../../clearance-requests/clearance-view";
import { TaskLineForm } from "./task-line-form";
import { AssetTaskItem } from "./asset-task-item";

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

type LineTask = {
  case_id: string;
  line_id: string;
  line_description: string;
  outcome: "Yes" | "No" | "N/A" | null;
  remarks: string | null;
  responded_at: string | null;
  assigned_at: string;
};
type AssetTask = {
  case_id: string;
  assignment_id: string;
  asset_tag: string;
  asset_name: string;
  serial_number: string | null;
  assigned_date: string;
  assigned_condition: string | null;
  asset_status: string;
  returned: boolean;
  assigned_at: string;
};
type CaseInfo = {
  case_id: string;
  case_number: string;
  employee_name: string;
  employee_code: string | null;
  last_working_date: string;
  case_status: string;
  part_locked: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
};
type Group = { info: CaseInfo; lines: LineTask[]; assets: AssetTask[] };

// "My clearance tasks": the lines of a clearance (talha_hr_0011) and the asset returns
// (talha_hr_0012) the IT Team Lead handed to me. The database functions return only my own
// tasks, so nothing else of the case is shown. The notification emails link here.
export default async function MyClearanceTasksPage() {
  const supabase = await createClient();
  const hr = supabase.schema("hr");
  const [linesResult, assetsResult] = await Promise.all([
    hr.rpc("my_clearance_tasks"),
    hr.rpc("my_clearance_asset_tasks"),
  ]);
  // Before talha_hr_0012 is live my_clearance_asset_tasks is missing: show the lines only.
  const error = linesResult.error;

  const groups = new Map<string, Group>();
  const groupFor = (info: CaseInfo) => {
    const existing = groups.get(info.case_id);
    if (existing) return existing;
    const created: Group = { info, lines: [], assets: [] };
    groups.set(info.case_id, created);
    return created;
  };
  for (const t of linesResult.data ?? []) groupFor(t).lines.push(t);
  for (const t of assetsResult.error ? [] : (assetsResult.data ?? [])) groupFor(t).assets.push(t);

  // Newest first: the request with the most recently assigned task on top (lines inside a request
  // keep the form's order).
  const latestAssigned = (g: Group) =>
    [...g.lines.map((t) => t.assigned_at), ...g.assets.map((t) => t.assigned_at)].sort().at(-1) ?? "";
  const all = [...groups.values()].sort((a, b) => latestAssigned(b).localeCompare(latestAssigned(a)));
  const isOpen = (g: Group) => g.info.case_status === "In Clearance" && !g.info.part_locked;
  const open = all.filter(isOpen);
  const closed = all.filter((g) => !isOpen(g));
  const today = karachiToday();

  return (
    <div className="flex flex-col gap-6 py-6">
      <Link href="/hr/clearance-home" className="text-sm text-blue-700 hover:underline">
        ← Clearance
      </Link>
      <PageHeader
        title="My clearance tasks"
      />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load your clearance tasks. Please try again later.
        </p>
      )}

      {!error && open.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-400">No clearance tasks for you right now.</p>
        </div>
      )}

      {open.map(({ info: c, lines, assets }) => {
        const openAssets = assets.filter((a) => !a.returned);
        const left = lines.filter((t) => !t.outcome).length + openAssets.length;
        const total = lines.length + assets.length;
        return (
          <section key={c.case_id} className={card}>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{c.employee_name}</h2>
                <p className="text-xs text-slate-500">
                  {[c.case_number, c.employee_code].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-slate-500">
                  Last working date {formatDay(c.last_working_date)} (
                  {daysLeftText(c.last_working_date, today)})
                </p>
              </div>
              <span className={left > 0 ? "text-sm text-amber-700" : "text-sm text-green-700"}>
                {left > 0 ? `${left} of ${total} still to do` : "All done"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Assigned by {c.assigned_by_name ?? "the IT Team Lead"} on {formatTimestamp(c.assigned_at)}
            </p>

            {/* Progress as the shared vertical stepper (as on onboarding); the work itself is below. */}
            <TaskProgressSummary
              className="mt-4 rounded-lg bg-slate-50 p-3"
              tasks={[
                ...lines.map((t) => ({
                  id: `l-${t.line_id}`,
                  label: t.line_description,
                  state: (t.outcome === "N/A" ? "skipped" : t.outcome ? "done" : "active") as TaskBallState,
                  meta: t.outcome ? `Answered: ${t.outcome}` : "To do",
                })),
                ...assets.map((a) => ({
                  id: `a-${a.assignment_id}`,
                  label: `Collect ${a.asset_tag} · ${a.asset_name}`,
                  state: (a.returned ? "done" : "active") as TaskBallState,
                  meta: a.returned ? "Returned" : a.asset_status === "In Repair" ? "In repair" : "To do",
                })),
              ]}
            />

            {lines.length > 0 && (
              <ol className="flex flex-col divide-y divide-slate-100">
                {lines.map((t) => (
                  <TaskLineForm
                    // An answer saved elsewhere (e.g. by the lead) draws the line fresh.
                    key={`${t.line_id}|${t.responded_at ?? ""}`}
                    caseId={t.case_id}
                    lineId={t.line_id}
                    description={t.line_description}
                    outcome={t.outcome}
                    remarks={t.remarks}
                  />
                ))}
              </ol>
            )}

            {assets.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Assets to collect
                </h3>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {assets.map((a) =>
                    a.returned ? (
                      <li key={a.assignment_id} className="py-3 text-sm text-green-700">
                        {a.asset_tag} · {a.asset_name}: returned
                      </li>
                    ) : (
                      <AssetTaskItem
                        key={a.assignment_id}
                        caseId={a.case_id}
                        assignmentId={a.assignment_id}
                        title={`${a.asset_tag} · ${a.asset_name}${a.serial_number ? ` · S/N ${a.serial_number}` : ""}`}
                        detail={`Assigned since ${formatDay(a.assigned_date)}${
                          a.assigned_condition ? ` (condition at handover: ${a.assigned_condition})` : ""
                        }`}
                        inRepair={a.asset_status === "In Repair"}
                      />
                    ),
                  )}
                </ul>
              </>
            )}
          </section>
        );
      })}

      {closed.length > 0 && (
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Finished
          </h2>
          <ul className="divide-y divide-slate-100">
            {closed.map(({ info: c, lines, assets }) => (
              <li key={c.case_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-slate-900">{c.employee_name}</p>
                  <p className="text-xs text-slate-500">
                    {c.case_number} · {lines.length + assets.length} task
                    {lines.length + assets.length === 1 ? "" : "s"}
                    {c.part_locked ? " · IT part signed" : ""}
                  </p>
                </div>
                <StatusPill
                  label={c.case_status}
                  tone={STATUS_TONE[c.case_status as keyof typeof STATUS_TONE] ?? "neutral"}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
