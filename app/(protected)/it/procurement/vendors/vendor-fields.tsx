import type { ItVendor } from "@/types/database";
import { inputClass, labelClass } from "../../_components/ticket-ui";
import { FormGroup } from "../_components/ui";

// One set of fields for both Add and Edit (defaults empty for Add).
export function VendorFields({ vendor }: { vendor?: ItVendor }) {
  return (
    <div className="divide-y divide-slate-100">
      <FormGroup title="Company" hint="The supplier's registered name and tax details.">
        <label className="block sm:col-span-2">
          <span className={labelClass}>
            Vendor name <span className="text-red-500">*</span>
          </span>
          <input
            name="vendorName"
            required
            defaultValue={vendor?.vendor_name ?? ""}
            placeholder="e.g. ABC Computers (Pvt) Ltd"
            className={inputClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>Tax number (NTN / STRN)</span>
          <input name="taxNumber" defaultValue={vendor?.tax_number ?? ""} className={inputClass} />
        </label>
      </FormGroup>

      <FormGroup title="Contact" hint="Who IT calls about orders, delivery and repairs.">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Contact person</span>
          <input name="contactPerson" defaultValue={vendor?.contact_person ?? ""} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Phone</span>
          <input
            name="contactNo"
            type="tel"
            defaultValue={vendor?.contact_no ?? ""}
            placeholder="03xx-xxxxxxx"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Email</span>
          <input type="email" name="email" defaultValue={vendor?.email ?? ""} className={inputClass} />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>Address</span>
          <input name="address" defaultValue={vendor?.address ?? ""} className={inputClass} />
        </label>
      </FormGroup>

      <FormGroup title="Notes" hint="Optional — payment terms, warranty, anything worth knowing.">
        <label className="block sm:col-span-2">
          <span className="sr-only">Notes</span>
          <textarea name="notes" rows={3} defaultValue={vendor?.notes ?? ""} className={inputClass} />
        </label>
      </FormGroup>
    </div>
  );
}
