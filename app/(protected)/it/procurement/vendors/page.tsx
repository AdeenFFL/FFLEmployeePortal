import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { cardClass, FormMessage, primaryButtonClass } from "../../_components/ticket-ui";
import { EmptyState, FilterChips, initials } from "../_components/ui";

const PATH = "/it/procurement/vendors";

// PRC-01 Vendor Master (BRD §5.5.7 "Vendor Master", gap 4.5 #5 "IT Manager lacks vendor
// details"). A plain table; each row opens the vendor's own page (/vendors/[id]) where it is
// edited. Adding is /vendors/new. Read-only for anyone who can read the procurement masters;
// writes need it.vendors.update (javaria_it_0013 improvements).
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const supabase = await createClient();

  // Readable by procurement / approvers / inventory staff; editable with it.vendors.update.
  const [{ data: canRead }, canEdit] = await Promise.all([
    supabase.schema("it").rpc("can_read_procurement_masters"),
    hasItPermission(supabase, "it.vendors.update"),
  ]);
  if (!canRead) notFound();

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
  const filtered = Boolean(q) || status !== "active";

  const href = (s: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s !== "active") sp.set("status", s);
    const qs = sp.toString();
    return qs ? `${PATH}?${qs}` : PATH;
  };

  return (
    <div className="py-6">
      <PageHeader
        title="Vendors"
        description="Suppliers IT buys from. Click a vendor to see or change it."
        action={
          canEdit ? (
            <Link href={`${PATH}/new`} className={primaryButtonClass}>
              + Add vendor
            </Link>
          ) : undefined
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form method="get" className="relative min-w-[16rem] flex-1">
          {status !== "active" && <input type="hidden" name="status" value={status} />}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search name, contact, email or tax no. — press Enter"
            aria-label="Search vendors"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </form>
        <FilterChips
          label="Status"
          items={[
            { label: "Active", href: href("active"), active: status === "active" },
            { label: "Inactive", href: href("inactive"), active: status === "inactive" },
            { label: "All", href: href("all"), active: status === "all" },
          ]}
        />
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No vendors match" : "No vendors yet"}
            text={filtered ? "Try another search or status." : canEdit ? "Add the first supplier." : undefined}
            action={!filtered && canEdit ? { href: `${PATH}/new`, label: "Add vendor" } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Vendor</th>
                  <th className="px-4 py-3">Contact person</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Tax no.</th>
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((v) => (
                  <tr key={v.id} className="relative transition hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                          {initials(v.vendor_name)}
                        </span>
                        <div className="min-w-0">
                          <Link
                            href={`${PATH}/${v.id}`}
                            className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-blue-700"
                          >
                            {v.vendor_name}
                          </Link>
                          {v.address && <p className="max-w-xs truncate text-xs text-slate-500">{v.address}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{v.contact_person ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{v.contact_no ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{v.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{v.tax_number ?? "—"}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          v.is_active ? "text-emerald-700" : "text-slate-400"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${v.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                        />
                        {v.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {rows.length} vendor{rows.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
