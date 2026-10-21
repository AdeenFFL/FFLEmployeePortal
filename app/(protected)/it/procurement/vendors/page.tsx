import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked } from "@/lib/it/ticket-data";
import type { ItVendor } from "@/types/database";
import { createVendor, setVendorActive, updateVendor } from "./actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

// One set of fields for both Add and Edit (defaults empty for Add).
function VendorFields({ vendor }: { vendor?: ItVendor }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="block">
        <span className={labelClass}>
          Vendor name <span className="text-red-500">*</span>
        </span>
        <input name="vendorName" required defaultValue={vendor?.vendor_name ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Contact person</span>
        <input name="contactPerson" defaultValue={vendor?.contact_person ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Contact no.</span>
        <input name="contactNo" defaultValue={vendor?.contact_no ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Email</span>
        <input type="email" name="email" defaultValue={vendor?.email ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Tax number (NTN / STRN)</span>
        <input name="taxNumber" defaultValue={vendor?.tax_number ?? ""} className={inputClass} />
      </label>
      <label className="block md:col-span-3">
        <span className={labelClass}>Address</span>
        <input name="address" defaultValue={vendor?.address ?? ""} className={inputClass} />
      </label>
      <label className="block md:col-span-3">
        <span className={labelClass}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={vendor?.notes ?? ""} className={inputClass} />
      </label>
    </div>
  );
}

// PRC-01 Vendor Master (BRD §5.5.7 "Vendor Master", gap 4.5 #5 "IT Manager lacks vendor
// details"). Gated by it.vendors.update.
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const supabase = await createClient();

  let query = supabase.schema("it").from("vendors").select("*").order("vendor_name");
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  const q = (params.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) {
    query = query.or(
      `vendor_name.ilike.%${q}%,contact_person.ilike.%${q}%,email.ilike.%${q}%,tax_number.ilike.%${q}%`,
    );
  }
  const { data: vendors } = checked(await query);
  const rows = vendors ?? [];

  return (
    <div className="py-6">
      <PageHeader
        title="Vendor Master"
        description="Suppliers that demands, receiving, assets and repairs are linked to. Deactivate instead of deleting."
        action={
          <Link href="/it/procurement/products" className={secondaryButtonClass}>
            Product Master
          </Link>
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      <details className={`${cardClass} mb-6 p-6`} open={rows.length === 0 && !q}>
        <summary className="cursor-pointer text-base font-semibold text-slate-900">Add vendor</summary>
        <form action={createVendor} className="mt-4 space-y-4">
          <VendorFields />
          <button type="submit" className={primaryButtonClass}>
            Add vendor
          </button>
        </form>
      </details>

      <form method="get" className={`${cardClass} mb-6 flex flex-wrap items-center gap-3 p-4`}>
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name, contact, email or tax number"
          aria-label="Search vendors"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <select name="status" defaultValue={status} aria-label="Status" className={`${inputClass} w-auto`}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={primaryButtonClass}>
          Search
        </button>
      </form>

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {q || status !== "active" ? "No vendors match." : "No vendors yet — add the first one above."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((v) => (
              <li key={v.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {v.vendor_name}{" "}
                      {!v.is_active && <StatusPill label="Inactive" tone="neutral" />}
                    </p>
                    <p className="text-sm text-slate-600">
                      {[v.contact_person, v.contact_no, v.email].filter(Boolean).join(" · ") || "No contact details"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {[v.tax_number && `Tax no. ${v.tax_number}`, v.address].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <form action={setVendorActive.bind(null, v.id, !v.is_active)}>
                    <button
                      type="submit"
                      className={
                        v.is_active
                          ? "text-sm text-slate-500 hover:text-red-600"
                          : "text-sm font-medium text-blue-700 hover:underline"
                      }
                    >
                      {v.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit</summary>
                  <form action={updateVendor.bind(null, v.id)} className="mt-3 space-y-3">
                    <VendorFields vendor={v} />
                    <button type="submit" className={primaryButtonClass}>
                      Save vendor
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
