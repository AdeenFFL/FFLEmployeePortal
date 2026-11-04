import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/status-pill";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { DEMAND_STATUS_TONE } from "@/lib/it/procurement";
import { cardClass, FormMessage, primaryButtonClass } from "../../../_components/ticket-ui";
import { BackLink, initials } from "../../_components/ui";
import { setVendorActive, updateVendor } from "../actions";
import { VendorFields } from "../vendor-fields";

const RECENT_DEMANDS = 5;

// One vendor (PRC-01): contact details, the demands assigned to it, and — with
// it.vendors.update — the edit form and activate / deactivate. Vendors are never deleted
// (demands, assets and repairs keep pointing at them).
export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const [{ data: canRead }, canEdit] = await Promise.all([
    supabase.schema("it").rpc("can_read_procurement_masters"),
    hasItPermission(supabase, "it.vendors.update"),
  ]);
  if (!canRead) notFound();

  const [vendorRes, demandsRes] = await Promise.all([
    supabase.schema("it").from("vendors").select("*").eq("id", id).maybeSingle(),
    supabase
      .schema("it")
      .from("demands")
      .select("id, demand_number, quantity, status, created_at", { count: "exact" })
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .limit(RECENT_DEMANDS),
  ]);
  const vendor = checked(vendorRes).data;
  if (!vendor) notFound();
  // Demands are RLS-filtered: this is what the viewer may see, not necessarily every demand.
  const demands = demandsRes.error ? [] : (demandsRes.data ?? []);
  const demandCount = demandsRes.error ? 0 : (demandsRes.count ?? demands.length);

  return (
    <div className="py-6">
      <div className="mb-3">
        <BackLink href="/it/procurement/vendors" label="Vendors" />
      </div>

      {/* Summary */}
      <div className={`${cardClass} mb-6 flex flex-wrap items-center gap-5 p-6`}>
        <span
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-semibold ${
            vendor.is_active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400"
          }`}
        >
          {initials(vendor.vendor_name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-slate-900">
            {vendor.vendor_name}
            {!vendor.is_active && <StatusPill label="Inactive" tone="warning" />}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[vendor.contact_person, vendor.tax_number && `Tax no. ${vendor.tax_number}`].filter(Boolean).join(" · ") ||
              "No contact person recorded"}
          </p>
          {vendor.address && <p className="text-sm text-slate-500">{vendor.address}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {vendor.contact_no && (
            <a
              href={`tel:${vendor.contact_no.replace(/[^\d+]/g, "")}`}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              📞 {vendor.contact_no}
            </a>
          )}
          {vendor.email && (
            <a
              href={`mailto:${vendor.email}`}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              ✉ {vendor.email}
            </a>
          )}
        </div>
      </div>

      <FormMessage error={sp.error} notice={sp.notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {canEdit ? (
            <form action={updateVendor.bind(null, vendor.id)} className={cardClass}>
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">Edit vendor</h2>
              </div>
              <VendorFields vendor={vendor} />
              <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-6 py-4">
                <button type="submit" className={primaryButtonClass}>
                  Save changes
                </button>
              </div>
            </form>
          ) : (
            <div className={`${cardClass} p-6`}>
              <h2 className="mb-2 text-base font-semibold text-slate-900">Notes</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{vendor.notes || "No notes recorded."}</p>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className={cardClass}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Assigned demands</h2>
              <span className="text-xs text-slate-400">{demandCount} total</span>
            </div>
            {demands.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">No demands assigned to this vendor yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {demands.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/it/procurement/demands/${d.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{d.demand_number}</span>
                        <span className="block text-xs text-slate-500">
                          Qty {d.quantity} · {new Date(d.created_at).toLocaleDateString("en-GB")}
                        </span>
                      </span>
                      <StatusPill label={d.status} tone={DEMAND_STATUS_TONE[d.status as keyof typeof DEMAND_STATUS_TONE]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canEdit && (
            <div className={`${cardClass} p-5`}>
              <h2 className="text-sm font-semibold text-slate-900">
                {vendor.is_active ? "Stop using this vendor" : "Use this vendor again"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {vendor.is_active
                  ? "Deactivated vendors can't be picked for new demands. Existing demands, assets and repairs are not affected."
                  : "Reactivating makes it available for new demands again."}
              </p>
              <form action={setVendorActive.bind(null, vendor.id, !vendor.is_active)} className="mt-3">
                <button
                  type="submit"
                  className={
                    vendor.is_active
                      ? "w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      : "w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  }
                >
                  {vendor.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
