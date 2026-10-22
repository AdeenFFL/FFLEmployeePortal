import Link from "next/link";
import { PageHeader } from "@/components/page-header";
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
