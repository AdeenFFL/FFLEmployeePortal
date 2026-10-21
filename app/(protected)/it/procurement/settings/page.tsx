import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked } from "@/lib/it/ticket-data";
import { updateProcurementSettings } from "./actions";
import { cardClass, FormMessage, inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";

// Procurement settings (09 addition P4). Values are stored now and used by later phases:
// finance SLA + reminders (Phase 6 payments), invoice tolerance (Phase 5 invoices), consumable
// path (Phase 4 receiving). Gated by it.procurement_settings.update.
export default async function ProcurementSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: settings } = checked(
    await supabase.schema("it").from("procurement_settings").select("*").eq("id", true).maybeSingle(),
  );

  return (
    <div className="py-6">
      <PageHeader
        title="Procurement Settings"
        description="Rules the demand, invoice and payment steps follow."
      />
      <FormMessage error={params.error} notice={params.notice} />

      {!settings ? (
        <p className={`${cardClass} p-6 text-sm text-slate-500`}>
          The settings row is missing — run javaria_it_0009_procurement_masters.sql.
        </p>
      ) : (
        <form action={updateProcurementSettings} className={`${cardClass} max-w-2xl space-y-5 p-6`}>
          <label className="block">
            <span className={labelClass}>Finance SLA (days)</span>
            <input
              type="number"
              name="financeSlaDays"
              min={1}
              max={90}
              required
              defaultValue={settings.finance_sla_days}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">
              Days Finance has to pay an approved invoice before it shows as overdue.
            </span>
          </label>
          <label className="block">
            <span className={labelClass}>Reminder interval (days)</span>
            <input
              type="number"
              name="reminderIntervalDays"
              min={1}
              max={30}
              required
              defaultValue={settings.reminder_interval_days}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">
              How often pending approvers and Finance are reminded.
            </span>
          </label>
          <label className="block">
            <span className={labelClass}>Invoice tolerance (%)</span>
            <input
              type="number"
              name="invoiceTolerancePct"
              min={0}
              max={20}
              step="0.01"
              required
              defaultValue={settings.invoice_tolerance_pct}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-slate-400">
              How far an invoice total may differ from the approved demand before it needs re-approval.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="consumablePathEnabled"
              defaultChecked={settings.consumable_path_enabled}
              className="mt-1 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">Allow consumable receiving</span>
              <span className="block text-xs text-slate-400">
                Products without an asset type are received into stock instead of registered as assets.
              </span>
            </span>
          </label>
          <button type="submit" className={primaryButtonClass}>
            Save settings
          </button>
        </form>
      )}
    </div>
  );
}
