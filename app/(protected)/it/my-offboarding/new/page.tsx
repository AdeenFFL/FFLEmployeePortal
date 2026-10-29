import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import { createSelfOffboardingRequest } from "../actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";
import { ConfirmSubmit } from "./confirm-submit";

// Self-service counterpart to app/(protected)/it/onboarding/new/page.tsx's HR-facing
// Offboarding tab (IT module revision, Phase 5) — deliberately much shorter: no employee
// picker or reporting-manager field, since it's always about the person filing it.
export default async function NewSelfOffboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // The person's own record (javaria_it_0018 it.employee_lookup — self lookup is allowed), shown
  // read-only so nothing has to be re-typed; the category comes from the employment type.
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  const { data: rows } = personId
    ? await supabase.schema("it").rpc("employee_lookup", { p_person_id: personId })
    : { data: [] };
  const me = rows?.[0] ?? null;
  const knownCategory = me?.employee_category ?? null;
  const defaultLastDay = knownCategory === "Contractual" ? (me?.contract_end_date ?? "") : "";
  const fmtDate = (d: string | null | undefined) =>
    d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "—";

  return (
    <div className="py-6">
      <PageHeader
        title="Request offboarding"
        description="Tell IT you're leaving so they can prepare your mailbox backup, access revocation and asset recovery."
        action={
          <Link href="/it/my-offboarding" className={secondaryButtonClass}>
            Back
          </Link>
        }
      />
      <FormMessage error={error} />

      <form action={createSelfOffboardingRequest} className={`${cardClass} space-y-6 p-6`}>
        {me && (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-base font-semibold text-slate-900">{me.full_name}</p>
            <p className="mb-3 text-sm text-slate-500">{me.employee_code ?? "No employee code on your record"}</p>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              {[
                ["Designation", me.designation ?? "—"],
                ["Company", me.company_name ?? "—"],
                ["Location", me.site_name ?? "—"],
                ["Employee category", knownCategory ?? "—"],
                ["Joining date", fmtDate(me.date_of_joining)],
                ...(me.contract_end_date ? [["Contract ends", fmtDate(me.contract_end_date)]] : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-0.5 text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              From your employee record. If something here is wrong, mention it in the remarks — HR keeps
              the record up to date.
            </p>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>
              Last working date <span className="text-red-500">*</span>
            </span>
            <input type="date" name="lastWorkingDate" required defaultValue={defaultLastDay} className={inputClass} />
            {defaultLastDay && (
              <span className="mt-1 block text-xs text-slate-400">Pre-filled from your contract end date.</span>
            )}
          </label>
          {knownCategory ? (
            <input type="hidden" name="employeeCategory" value={knownCategory} />
          ) : (
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
              <span className="mt-1 block text-xs text-slate-400">Your record doesn&apos;t say — please choose.</span>
            </label>
          )}
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
