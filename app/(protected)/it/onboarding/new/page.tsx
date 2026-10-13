import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { fetchOrgUnits } from "@/lib/it/ticket-data";
import { LIFECYCLE_KINDS } from "@/lib/it/onboarding";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItLifecycleKind } from "@/types/database";
import { createLifecycleRequest } from "../actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

const INTRO: Record<ItLifecycleKind, string> = {
  Onboarding:
    "New joiner details for IT (BRD §5.1.1). IT gets a checklist for email, access, software, equipment and the portal account.",
  Offboarding:
    "Leaver details for IT (BRD §5.2.1). IT gets a checklist for mailbox backup, access revocation and asset recovery, routed to the HQ or plant-site IT team by location.",
  Replacement: "Equipment replacement for an existing employee: return the old asset, issue the new one.",
};

// ONB-01 — HR raises an onboarding / offboarding / replacement request.
export default async function NewLifecycleRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; error?: string }>;
}) {
  const params = await searchParams;
  const kind: ItLifecycleKind = LIFECYCLE_KINDS.includes(params.kind as ItLifecycleKind)
    ? (params.kind as ItLifecycleKind)
    : "Onboarding";
  const isOnboarding = kind === "Onboarding";
  const supabase = await createClient();

  const [{ sites, departments }, { data: employees }] = await Promise.all([
    fetchOrgUnits(supabase),
    !isOnboarding && params.q
      ? supabase.schema("it").rpc("search_employees", { p_search: params.q })
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="py-6">
      <PageHeader
        title={`New ${kind.toLowerCase()} request`}
        description={INTRO[kind]}
        action={
          <Link href="/it/onboarding" className={secondaryButtonClass}>
            Back to list
          </Link>
        }
      />
      <FormMessage error={params.error} />

      <div className="mb-6 flex flex-wrap gap-2">
        {LIFECYCLE_KINDS.map((k) => (
          <Link
            key={k}
            href={`/it/onboarding/new?kind=${k}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              k === kind ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
            }`}
          >
            {k}
          </Link>
        ))}
      </div>

      {!isOnboarding && (
        <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-4`}>
          <input type="hidden" name="kind" value={kind} />
          <label className="flex-1">
            <span className={labelClass}>
              Find the employee <span className="text-red-500">*</span>
            </span>
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Name or employee code"
              className={inputClass}
            />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
      )}

      <form action={createLifecycleRequest} className={`${cardClass} space-y-6 p-6`}>
        <input type="hidden" name="kind" value={kind} />

        {!isOnboarding && (
          <fieldset>
            <legend className={labelClass}>Employee</legend>
            {!params.q ? (
              <p className="text-sm text-slate-400">Search above to pick the employee.</p>
            ) : (employees ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">No employees match “{params.q}”.</p>
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
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          {isOnboarding && (
            <>
              <Field label="Employee name" required>
                <input name="employeeName" required className={inputClass} />
              </Field>
              <Field label="Employee number">
                <input name="employeeCode" placeholder="e.g. EMP-001" className={inputClass} />
              </Field>
            </>
          )}
          <Field label={isOnboarding ? "Designation / job title" : "Designation (if changed)"}>
            <input name="designation" className={inputClass} />
          </Field>
          {isOnboarding && (
            <Field label="Grade">
              <input name="grade" className={inputClass} />
            </Field>
          )}
          <Field label="Department">
            <select name="departmentId" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isOnboarding ? "Work location" : "Location (if different)"}>
            <select name="siteId" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reporting manager">
            <input name="reportingManager" className={inputClass} />
          </Field>
          <Field label="Employee category" required={kind === "Offboarding"}>
            <select
              name="employeeCategory"
              defaultValue=""
              required={kind === "Offboarding"}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="Permanent">Permanent</option>
              <option value="Contractual">Contractual</option>
            </select>
          </Field>
          {isOnboarding ? (
            <>
              <Field label="Joining date" required>
                <input type="date" name="joiningDate" required className={inputClass} />
              </Field>
              <Field label="Personal email">
                <input
                  type="email"
                  name="personalEmail"
                  placeholder="Where credentials will be sent"
                  className={inputClass}
                />
              </Field>
            </>
          ) : (
            kind === "Offboarding" && (
              <Field label="Last working date" required>
                <input type="date" name="lastWorkingDate" required className={inputClass} />
              </Field>
            )
          )}
          <Field label="Priority">
            <select name="priority" defaultValue="Medium" className={inputClass}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {isOnboarding ? (
          <section className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="emailRequired" defaultChecked className="h-4 w-4" />
                Company email required
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="laptopRequired" className="h-4 w-4" />
                Laptop / equipment required
              </label>
            </div>
            <Field label="System / application access required">
              <textarea
                name="accessRequired"
                rows={2}
                placeholder="Teams, SharePoint, VPN, ERP, shared folders…"
                className={inputClass}
              />
            </Field>
            <Field label="Software requirements">
              <textarea
                name="softwareRequired"
                rows={2}
                placeholder="Office, Adobe Reader, department-specific software…"
                className={inputClass}
              />
            </Field>
          </section>
        ) : (
          <Field label="Known assets and accesses">
            <textarea
              name="knownAssetsAccesses"
              rows={3}
              placeholder="Laptop HP ProBook 450 (FFL-LAP-000123), access card, ERP, VPN…"
              className={inputClass}
            />
          </Field>
        )}

        <Field label="Remarks">
          <textarea name="remarks" rows={2} className={inputClass} />
        </Field>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button type="submit" className={primaryButtonClass}>
            Submit {kind.toLowerCase()} request
          </button>
        </div>
      </form>
    </div>
  );
}
