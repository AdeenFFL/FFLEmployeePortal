import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { fetchOrgUnits } from "@/lib/it/ticket-data";
import { TICKET_PRIORITIES } from "@/lib/it/tickets";
import type { ItLifecycleKind } from "@/types/database";
import { createLifecycleRequest } from "../actions";
import { ReportingManagerPicker } from "../_components/reporting-manager-picker";
import { EmployeePicker } from "../_components/employee-picker";
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

// ONB-01 — HR raises an onboarding / replacement request. Offboarding used to be a third tab
// here (gated by the same blanket it.onboarding.create as these two), but now that it has its
// own two dedicated, permission-split screens — /it/my-offboarding/new (self) and
// /it/my-offboarding/new-for-employee (site-scoped, on someone else's behalf) — this screen no
// longer offers it at all; any stale ?kind=Offboarding link just falls back to Onboarding below.
export default async function NewLifecycleRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; error?: string }>;
}) {
  const params = await searchParams;
  const kind: ItLifecycleKind = params.kind === "Replacement" ? "Replacement" : "Onboarding";
  const isOnboarding = kind === "Onboarding";
  const isReplacement = kind === "Replacement";
  const supabase = await createClient();

  const { sites, departments } = await fetchOrgUnits(supabase);

  return (
    <div className="py-6">
      <PageHeader
        title={`New ${kind.toLowerCase()} request`}
        action={
          <Link
            href={isReplacement ? "/it/inventory" : "/it/onboarding"}
            className={secondaryButtonClass}
          >
            {isReplacement ? "Back to Asset Register" : "Back to list"}
          </Link>
        }
      />
      <FormMessage error={params.error} />

      {/* key: a fresh, empty form on every visit (no date or name left over from the last
          request); autoComplete off so the browser doesn't fill in old values either. */}
      <form
        key={randomUUID()}
        action={createLifecycleRequest}
        autoComplete="off"
        className={`${cardClass} space-y-6 p-6`}
      >
        <input type="hidden" name="kind" value={kind} />

        {isReplacement && <EmployeePicker sites={sites} inputClass={inputClass} labelClass={labelClass} />}

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
          {isOnboarding && (
            <>
              <Field label="Designation / job title" required>
                <input name="designation" required className={inputClass} />
              </Field>
              <Field label="Grade">
                <input name="grade" className={inputClass} />
              </Field>
            </>
          )}
          <Field label="Department" required={isOnboarding}>
            <select name="departmentId" defaultValue="" required={isOnboarding} className={inputClass}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          {isOnboarding && (
            <Field label="Work location" required>
              <select name="siteId" defaultValue="" required className={inputClass}>
                <option value="">—</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Reporting manager" required={isOnboarding}>
            <ReportingManagerPicker name="reportingManagerId" required={isOnboarding} />
          </Field>
          {/* Replacement: designation, location and category come from the employee card above
              (javaria_it_0018). */}
          {isOnboarding && (
            <>
              <Field label="Employee category" required>
                <select name="employeeCategory" defaultValue="" required className={inputClass}>
                  <option value="">—</option>
                  <option value="Permanent">Permanent</option>
                  <option value="Contractual">Contractual</option>
                </select>
              </Field>
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
