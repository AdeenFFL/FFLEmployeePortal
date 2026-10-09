import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export default async function AnonymousFeedbackQueuePage() {
  const supabase = await createClient();

  // RLS ("anonymous_conversations hrbp read own department") already scopes this to only the
  // department(s) this viewer is registered as an HRBP for (hr.hrbp_departments).
  // department_org_unit_id isn't embedded here: it's a cross-schema FK into public.org_units,
  // which supabase-js can't type (see types/database.ts's note on anonymous_conversations) —
  // names are fetched separately below instead.
  const { data: conversations } = await supabase
    .schema("hr")
    .from("anonymous_conversations")
    .select("id, status, created_at, department_org_unit_id")
    .order("created_at", { ascending: false });

  const departmentIds = [...new Set((conversations ?? []).map((c) => c.department_org_unit_id))];
  const { data: departments } =
    departmentIds.length > 0
      ? await supabase.from("org_units").select("id, name").in("id", departmentIds)
      : { data: [] };
  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="py-6">
      <PageHeader
        title="Anonymous Feedback"
        description="Conversations from employees in your assigned department(s)."
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {(conversations ?? []).length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No anonymous conversations yet — either none have come in, or you aren't registered
            as an HRBP for any department (set up via hr.hrbp_departments).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(conversations ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/hr/feedback/anonymous/${c.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {departmentNameById.get(c.department_org_unit_id) ?? "Unknown department"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(c.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      c.status === "Closed"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {c.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
