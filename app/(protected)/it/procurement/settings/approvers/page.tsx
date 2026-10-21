import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { addApprover, removeApprover, setApproverScope } from "./actions";
import { cardClass, FormMessage, inputClass, primaryButtonClass, secondaryButtonClass } from "../../../_components/ticket-ui";

const linkButton = "text-sm font-medium text-blue-700 hover:underline";

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
        title="Department Approvers"
        description="Who approves each department's demands. Any one of a department's approvers can decide."
        action={
          <Link href="/it/procurement/settings" className={secondaryButtonClass}>
            Procurement Settings
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <p className="mb-6 text-sm text-slate-500">
        An approver also needs the <strong>Approve Demands</strong> permission on their role (IT Roles
        &amp; Permissions → Procurement). People without it are flagged below and won&apos;t receive
        approvals.
      </p>

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
                  {working.length === 0 && (
                    <StatusPill label="No approver — demands can't be sent for approval" tone="warning" />
                  )}
                </div>

                {list.length > 0 && (
                  <ul className="mb-3 divide-y divide-slate-100">
                    {list.map((a) => (
                      <li key={a.person_id} className="flex flex-wrap items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 text-sm text-slate-800">
                          {a.full_name}
                          {a.designation && <span className="ml-1 text-xs text-slate-400">· {a.designation}</span>}
                        </span>
                        {!a.has_permission && <StatusPill label="Missing Approve Demands permission" tone="negative" />}
                        <form
                          action={setApproverScope.bind(null, dept.id, a.person_id, "can_approve_demands", !a.can_approve_demands)}
                        >
                          <button type="submit" className={linkButton}>
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
                          <button type="submit" className={linkButton}>
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
                      placeholder="Add approver: search name or employee code"
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
                            <label key={c.person_id} className="flex items-center gap-2 text-sm">
                              <input type="radio" name="personId" value={c.person_id} required />
                              {c.full_name}
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
