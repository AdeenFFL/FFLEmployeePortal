import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { listOpenAssignments } from "@/lib/it/assets";
import { formatDateTime } from "@/lib/it/tickets";
import { cardClass, FormMessage, primaryButtonClass } from "../_components/ticket-ui";
import { formatDate } from "../inventory/asset-status";
import { acknowledgeAssignment } from "./actions";

// INV-05 — assets the signed-in employee currently holds. Any module:it holder; RLS
// (talha_it_0004) limits the rows to their own open assignments and the assets on them.
export default async function MyAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const assignments = personId ? await listOpenAssignments(supabase, personId) : [];

  return (
    <div className="py-6">
      <PageHeader
        title="My Assets"
        description="IT equipment currently assigned to you. Please acknowledge each item once you have received it."
      />
      <FormMessage error={error} notice={notice} />

      {assignments.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-slate-500`}>
          You have no IT assets assigned to you.
        </div>
      ) : (
        <div className={`${cardClass} overflow-x-auto`}>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Serial number</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Handover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignments.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {a.assets?.asset_tag ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {a.assets?.asset_name ?? "—"}
                    {a.remarks && <p className="mt-1 text-xs text-slate-500">{a.remarks}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {[a.assets?.manufacturer, a.assets?.model_number].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{a.assets?.asset_types?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {a.assets?.serial_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(a.assigned_date)}</td>
                  <td className="px-4 py-3 text-slate-700">{a.assigned_condition ?? "—"}</td>
                  <td className="px-4 py-3">
                    {a.acknowledged_at ? (
                      <span className="text-xs text-emerald-700">
                        Acknowledged {formatDateTime(a.acknowledged_at)}
                      </span>
                    ) : (
                      <form action={acknowledgeAssignment.bind(null, a.id)}>
                        <button type="submit" className={primaryButtonClass}>
                          Acknowledge
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
