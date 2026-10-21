import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { formatDate, formatDateTime } from "@/lib/it/tickets";
import { demandCategoryLabel, formatMoney } from "@/lib/it/procurement";
import { cardClass, FormMessage } from "../../_components/ticket-ui";

// PRC-06 Approval inbox (BRD §5.5.4–5.5.5): demands awaiting a decision in the departments the
// viewer is mapped to (it.department_approvers), and their recent decisions. Decisions are made
// on the demand page. Gated by it.demands.approve.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: personId }, { data: departmentIds }, orgUnits, productsRes] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.schema("it").rpc("my_approver_departments"),
    fetchOrgUnits(supabase),
    supabase.schema("it").from("products").select("id, product_name, unit"),
  ]);
  const departments = departmentIds ?? [];
  const productById = new Map((productsRes.data ?? []).map((p) => [p.id, p]));

  const [pendingRes, decisionsRes] = await Promise.all([
    departments.length
      ? supabase
          .schema("it")
          .from("demands")
          .select(
            "id, demand_number, product_id, quantity, estimated_unit_price, demand_category, department_id, site_id, requested_by_person_id, justification, updated_at",
          )
          .eq("status", "Pending Approval")
          .in("department_id", departments)
          .order("updated_at")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .schema("it")
      .from("demand_approvals")
      .select("id, demand_id, decision, approved_quantity, decided_at")
      .eq("approver_person_id", personId ?? "")
      .order("decided_at", { ascending: false })
      .limit(20),
  ]);
  const pending = checked(pendingRes).data ?? [];
  const decisions = decisionsRes.data ?? [];

  const decidedIds = [...new Set(decisions.map((d) => d.demand_id))];
  const { data: decidedDemands } = decidedIds.length
    ? await supabase.schema("it").from("demands").select("id, demand_number, product_id, quantity").in("id", decidedIds)
    : { data: [] };
  const decidedById = new Map((decidedDemands ?? []).map((d) => [d.id, d]));

  const requesterIds = [...new Set(pending.map((d) => d.requested_by_person_id))];
  const { data: people } = requesterIds.length
    ? await supabase.schema("it").rpc("demand_person_names", { p_person_ids: requesterIds })
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.person_id, p.full_name]));

  return (
    <div className="py-6">
      <PageHeader
        title="Approvals"
        description="Demands waiting for your decision as department head."
      />
      <FormMessage error={error} notice={notice} />

      {departments.length === 0 && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You aren&apos;t set as a demand approver for any department yet. An IT admin adds approvers
          under Procurement Settings → Department Approvers.
        </p>
      )}

      <section className={`${cardClass} mb-6`}>
        <h2 className="border-b border-slate-100 px-6 py-4 text-base font-semibold text-slate-900">
          Waiting for you ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Nothing to approve right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((d) => {
              const product = productById.get(d.product_id);
              const total = d.estimated_unit_price === null ? null : Number(d.estimated_unit_price) * d.quantity;
              const own = d.requested_by_person_id === personId;
              return (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      <Link href={`/it/procurement/demands/${d.id}`} className="text-blue-700 hover:underline">
                        {d.demand_number}
                      </Link>{" "}
                      · {d.quantity} {product?.unit ?? ""} × {product?.product_name ?? "product"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[
                        names.get(d.requested_by_person_id),
                        orgUnits.nameById.get(d.department_id),
                        orgUnits.nameById.get(d.site_id),
                        demandCategoryLabel(d.demand_category),
                        `sent ${formatDate(d.updated_at)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700">{d.justification}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums text-slate-900">{formatMoney(total)}</p>
                    {own ? (
                      <p className="text-xs text-slate-400">Your own demand — another approver decides</p>
                    ) : (
                      <Link
                        href={`/it/procurement/demands/${d.id}`}
                        className="text-sm font-medium text-blue-700 hover:underline"
                      >
                        Review &amp; decide →
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="border-b border-slate-100 px-6 py-4 text-base font-semibold text-slate-900">
          Your recent decisions
        </h2>
        {decisions.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No decisions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {decisions.map((a) => {
              const d = decidedById.get(a.demand_id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                  <Link href={`/it/procurement/demands/${a.demand_id}`} className="font-medium text-blue-700 hover:underline">
                    {d?.demand_number ?? "Demand"}
                  </Link>
                  <span className="text-slate-600">
                    {d ? (productById.get(d.product_id)?.product_name ?? "") : ""}
                  </span>
                  <StatusPill
                    label={a.decision === "Rejected" ? "Rejected" : `${a.decision} · ${a.approved_quantity}`}
                    tone={a.decision === "Rejected" ? "negative" : a.decision === "Approved" ? "positive" : "warning"}
                  />
                  <span className="ml-auto text-xs text-slate-400">{formatDateTime(a.decided_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
