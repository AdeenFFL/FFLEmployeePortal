import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import { createSiteOffboardingRequest } from "../actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";
import { ConfirmSubmit } from "../new/confirm-submit";

// hr.offboarding.create_for_site_users counterpart to ../new/page.tsx: same fields, but with an
// employee picker (scoped to it.search_employees_for_my_sites — only people at a site the caller
// is on the IT team for) instead of always filing for the caller themselves.
export default async function NewSiteOffboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const { q, error } = await searchParams;
  const supabase = await createClient();

  const { data: employees } = q
    ? await supabase.schema("it").rpc("search_employees_for_my_sites", { p_search: q })
    : { data: null };

  return (
    <div className="py-6">
      <PageHeader
        title="Submit offboarding request"
        description="File an offboarding request for an employee at one of your sites so IT can prepare their mailbox backup, access revocation and asset recovery."
        action={
          <Link href="/it/my-offboarding" className={secondaryButtonClass}>
            Back
          </Link>
        }
      />
      <FormMessage error={error} />

      <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-4`}>
        <label className="flex-1">
          <span className={labelClass}>
            Find the employee <span className="text-red-500">*</span>
          </span>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name or employee code"
            className={inputClass}
          />
        </label>
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      <form action={createSiteOffboardingRequest} className={`${cardClass} space-y-6 p-6`}>
        <fieldset>
          <legend className={labelClass}>Employee</legend>
          {!q ? (
            <p className="text-sm text-slate-400">Search above to pick the employee.</p>
          ) : (employees ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">
              No employees match &ldquo;{q}&rdquo; at your sites.
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {(employees ?? []).map((e) => (
                <li key={e.person_id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="radio" name="personId" value={e.person_id} required />
                    <span className="font-medium text-slate-800">{e.full_name}</span>
                    <span className="text-slate-500">
                      {[e.employee_code, e.designation].filter(Boolean).join(" · ")}
                    </span>
                    {e.status !== "Active" && (
                      <span className="text-xs text-amber-600">{e.status}</span>
                    )}
                    {!e.onboarding_cleared && (
                      <span className="text-xs text-red-600">Onboarding not yet completed</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>
              Last working date <span className="text-red-500">*</span>
            </span>
            <input type="date" name="lastWorkingDate" required className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>
              Employee category <span className="text-red-500">*</span>
            </span>
            <select name="employeeCategory" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Select…
              </option>
              <option value="Permanent">Permanent</option>
              <option value="Contractual">Contractual</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Priority</span>
            <select name="priority" defaultValue="Medium" className={inputClass}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </section>

        <label className="block">
          <span className={labelClass}>Known assets and accesses</span>
          <textarea
            name="knownAssetsAccesses"
            rows={3}
            placeholder="Laptop, access card, ERP, VPN… anything IT should know to recover"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Remarks</span>
          <textarea name="remarks" rows={2} className={inputClass} />
        </label>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <ConfirmSubmit />
        </div>
      </form>
    </div>
  );
}
