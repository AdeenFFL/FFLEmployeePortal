import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { addApprover, removeApprover, setApproverScope } from "./actions";
import { cardClass, FormMessage, inputClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";
import { SETTINGS_TABS, SubTabs } from "../../_components/ui";

const chip = (on: boolean) =>
  `rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
    on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
  }`;

// PRC-08 Department approvers (09 addition P3; BRD §5.5.4 "the relevant Department Head").
// Gated by it.procurement_settings.update (route prefix /it/procurement/settings).
export default async function DepartmentApproversPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; dept?: string; q?: string }>;
}) {
  const { notice, error, dept: activeDept, q } = await searchParams;
  const supabase = await createClient();

  const [{ data: approvers }, { departments }, { data: candidates }] = await Promise.all([
    supabase.schema("it").rpc("list_department_approvers").then(checked),
    fetchOrgUnits(supabase),
    activeDept && q?.trim()
      ? supabase.schema("it").rpc("search_approver_candidates", { p_search: q })
      : Promise.resolve({ data: null }),
  ]);

  const byDept = new Map<string, NonNullable<typeof approvers>>();
  for (const a of approvers ?? []) {
    byDept.set(a.department_id, [...(byDept.get(a.department_id) ?? []), a]);
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Settings"
        description="Rules the demand, invoice and payment steps follow, and who approves each department."
      />
      <SubTabs items={SETTINGS_TABS} active="approvers" />
      <FormMessage error={error} notice={notice} />

      <div className="mb-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
        <Tip title="How it works">
          A demand goes to its department&apos;s approvers. Any one of them can decide. Adding an
          approver sends that department&apos;s waiting demands automatically.
        </Tip>
        <Tip title="Permission needed">
          The approver&apos;s role needs <strong>Approve Demands</strong> (and <strong>Approve Invoices</strong>) under
          IT Roles &amp; Permissions → Procurement. People without it are flagged below.
        </Tip>
        <Tip title="Department missing?">
          Add it under{" "}
          <Link href="/admin/departments" className="font-medium text-blue-700 hover:underline">
            Administration → Departments
          </Link>{" "}
          and it appears here. Nobody approves their own demand.
        </Tip>
      </div>

      {departments.length === 0 ? (
        <p className={`${cardClass} p-6 text-sm text-amber-700`}>
          No departments exist yet. Add them under Administration → Departments first.
        </p>
      ) : (
        <div className="space-y-4">
          {departments.map((dept) => {
            const list = byDept.get(dept.id) ?? [];
            const working = list.filter((a) => a.can_approve_demands && a.has_permission);
            const isActive = activeDept === dept.id;
            return (
              <section key={dept.id} id={`dept-${dept.id}`} className={`${cardClass} p-6`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{dept.name}</h2>
                  {working.length === 0 ? (
                    <StatusPill label="No approver yet — demands wait" tone="warning" />
                  ) : (
                    <StatusPill label={`Ready · ${working.length} approver${working.length === 1 ? "" : "s"}`} tone="positive" />
                  )}
                </div>

                {list.length > 0 && (
                  <ul className="mb-3 divide-y divide-slate-100">
                    {list.map((a) => (
                      <li key={a.person_id} className="flex flex-wrap items-center gap-3 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold uppercase text-blue-700">
                          {initials(a.full_name)}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                          {a.full_name}
                          {a.designation && <span className="ml-1 text-xs font-normal text-slate-400">· {a.designation}</span>}
                        </span>
                        {!a.has_permission && <StatusPill label="Missing Approve Demands permission" tone="negative" />}
                        <form
                          action={setApproverScope.bind(null, dept.id, a.person_id, "can_approve_demands", !a.can_approve_demands)}
                        >
                          <button type="submit" className={chip(a.can_approve_demands)} title="Click to switch">
                            {a.can_approve_demands ? "✓ Demands" : "Demands off"}
                          </button>
                        </form>
                        <form
                          action={setApproverScope.bind(
                            null,
                            dept.id,
                            a.person_id,
                            "can_approve_invoices",
                            !a.can_approve_invoices,
                          )}
                        >
                          <button type="submit" className={chip(a.can_approve_invoices)} title="Click to switch">
                            {a.can_approve_invoices ? "✓ Invoices" : "Invoices off"}
                          </button>
                        </form>
                        <form action={removeApprover.bind(null, dept.id, a.person_id)}>
                          <button type="submit" className="text-sm text-slate-500 hover:text-red-600">
                            Remove
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="rounded-lg bg-slate-50 p-3">
                  <form method="get" className="flex flex-wrap gap-2">
                    <input type="hidden" name="dept" value={dept.id} />
                    <input
                      name="q"
                      defaultValue={isActive ? (q ?? "") : ""}
                      placeholder="Add an approver — search name or employee code"
                      aria-label={`Search people to add as ${dept.name} approver`}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <button type="submit" className={secondaryButtonClass}>
                      Search
                    </button>
                  </form>
                  {isActive && q?.trim() && (
                    <form action={addApprover.bind(null, dept.id)} className="mt-3 space-y-2">
                      {(candidates ?? []).length === 0 ? (
                        <p className="text-xs text-slate-400">No active employee matches “{q}”.</p>
                      ) : (
                        <>
                          {(candidates ?? []).map((c) => (
                            <label
                              key={c.person_id}
                              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-blue-300 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/60"
                            >
                              <input type="radio" name="personId" value={c.person_id} required className="text-blue-600" />
                              <span className="font-medium text-slate-800">{c.full_name}</span>
                              <span className="text-xs text-slate-400">
                                {[c.employee_code, c.designation].filter(Boolean).join(" · ")}
                              </span>
                            </label>
                          ))}
                          <div className="flex flex-wrap items-center gap-4 pt-1">
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="checkbox" name="invoices" defaultChecked className="h-4 w-4 rounded border-slate-300" />
                              Also approves invoices
                            </label>
                            <button type="submit" className={primaryButtonClass}>
                              Add to {dept.name}
                            </button>
                          </div>
                        </>
                      )}
                    </form>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
