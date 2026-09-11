import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/require-user";
import { removeDependent } from "./actions";
import { DependentFormPanel } from "./dependent-form";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { DependentStatus } from "@/types/database";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function dependentStatusTone(
  status: DependentStatus,
): "positive" | "warning" | "negative" {
  if (status === "Approved") return "positive";
  if (status === "Rejected") return "negative";
  return "warning";
}

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; edit?: string }>;
}) {
  const { compose, edit } = await searchParams;
  const { supabase, personId } = await requireActiveUser();

  const { data: policy } = await supabase
    .from("insurance_policies")
    .select("*")
    .eq("person_id", personId)
    .maybeSingle();

  const { data: dependents } = await supabase
    .from("dependents")
    .select("*")
    .eq("person_id", personId)
    .order("created_at");

  let panel: { mode: "new" | "edit"; initialValues: Parameters<typeof DependentFormPanel>[0]["initialValues"] } | null =
    null;

  if (compose === "new") {
    panel = {
      mode: "new",
      initialValues: { name: "", relationship: "", cnic_or_bform: null, date_of_birth: null },
    };
  } else if (edit) {
    const dependent = (dependents ?? []).find((d) => d.id === edit);
    if (dependent) panel = { mode: "edit", initialValues: dependent };
  }

  return (
    <div className="mx-auto max-w-4xl py-6">
      <PageHeader
        title="Medical Insurance & Dependents"
        description="View your policy details and manage your dependents."
      />

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Policy Summary
        </h2>
        {policy ? (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Provider</dt>
              <dd className="font-medium text-slate-800">{policy.provider ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Policy Number</dt>
              <dd className="font-medium text-slate-800">{policy.policy_number ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Coverage Type</dt>
              <dd className="font-medium text-slate-800">{policy.coverage_type ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Coverage Limit</dt>
              <dd className="font-medium text-slate-800">{policy.coverage_limit ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">
            Your HR team hasn&apos;t set up your insurance policy yet.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Dependents
          </h2>
          <Link
            href="/profile/insurance?compose=new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Dependent
          </Link>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Relationship</th>
                <th className="px-4 py-3">CNIC / B-form</th>
                <th className="px-4 py-3">Date of Birth</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(dependents ?? []).map((dep) => (
                <tr key={dep.id}>
                  <td className="px-4 py-3">{dep.name}</td>
                  <td className="px-4 py-3">{dep.relationship}</td>
                  <td className="px-4 py-3 text-slate-500">{dep.cnic_or_bform ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(dep.date_of_birth)}</td>
                  <td className="px-4 py-3">
                    <StatusPill label={dep.status} tone={dependentStatusTone(dep.status)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/profile/insurance?edit=${dep.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        Edit
                      </Link>
                      <form action={removeDependent.bind(null, dep.id)}>
                        <button type="submit" className="text-red-600 hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {(dependents ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    No dependents added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {panel && <DependentFormPanel mode={panel.mode} initialValues={panel.initialValues} />}
    </div>
  );
}
