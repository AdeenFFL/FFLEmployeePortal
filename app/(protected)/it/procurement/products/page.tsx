import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, hasItPermission } from "@/lib/it/ticket-data";
import { formatMoney } from "@/lib/it/procurement";
import { cardClass, FormMessage, primaryButtonClass } from "../../_components/ticket-ui";
import { EmptyState, FilterChips } from "../_components/ui";
import { ProductIcon, productKind } from "../_components/product-icon";

const PATH = "/it/procurement/products";

// PRC-02 Product Master (BRD §5.5.7, ERD D "products"). A plain table; each row opens the
// product's own page (/products/[id]) where it is edited. Adding is /products/new.
// Read-only for anyone who can read the procurement masters; writes need it.products.update.
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    kind?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const kind = params.kind === "asset" || params.kind === "consumable" ? params.kind : "all";
  const supabase = await createClient();

  const [{ data: canRead }, canEdit, showAmounts] = await Promise.all([
    supabase.schema("it").rpc("can_read_procurement_masters"),
    hasItPermission(supabase, "it.products.update"),
    hasItPermission(supabase, "it.amounts.read"),
  ]);
  if (!canRead) notFound();

  // Fixed asset = asset type classified Fixed (javaria_it_0022); everything else is stock.
  const { data: typeRows } = await supabase.schema("it").from("asset_types").select("id, name, classification");
  const types = typeRows ?? [];
  const fixedIds = types.filter((t) => t.classification === "Fixed").map((t) => t.id);

  let query = supabase.schema("it").from("products").select("*").is("service_category", null).order("product_name");
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (kind === "asset") query = query.in("asset_type_id", fixedIds.length ? fixedIds : ["00000000-0000-0000-0000-000000000000"]);
  if (kind === "consumable" && fixedIds.length) {
    query = query.or(`asset_type_id.is.null,asset_type_id.not.in.(${fixedIds.join(",")})`);
  }
  const q = (params.q ?? "").replace(/[,()*%]/g, " ").trim();
  if (q) {
    query = query.or(`product_name.ilike.%${q}%,category.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const rows = checked(await query).data ?? [];
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const fixed = new Set(fixedIds);
  const filtered = Boolean(q) || status !== "active" || kind !== "all";

  // Filter chips keep the other filters (and the search) when clicked.
  const href = (next: { kind?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const k = next.kind ?? kind;
    const s = next.status ?? status;
    if (k !== "all") sp.set("kind", k);
    if (s !== "active") sp.set("status", s);
    const qs = sp.toString();
    return qs ? `${PATH}?${qs}` : PATH;
  };

  return (
    <div className="py-6">
      <PageHeader
        title="Products"
        description="Items IT buys. Click a product to see or change it."
        action={
          canEdit ? (
            <Link href={`${PATH}/new`} className={primaryButtonClass}>
              + Add product
            </Link>
          ) : undefined
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form method="get" className="relative min-w-[16rem] flex-1">
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
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
            placeholder="Search products — press Enter"
            aria-label="Search products"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </form>
        <FilterChips
          label="Kind"
          items={[
            { label: "All", href: href({ kind: "all" }), active: kind === "all" },
            { label: "Fixed assets", href: href({ kind: "asset" }), active: kind === "asset" },
            { label: "Consumables", href: href({ kind: "consumable" }), active: kind === "consumable" },
          ]}
        />
        <FilterChips
          label="Status"
          items={[
            { label: "Active", href: href({ status: "active" }), active: status === "active" },
            { label: "Inactive", href: href({ status: "inactive" }), active: status === "inactive" },
            { label: "All", href: href({ status: "all" }), active: status === "all" },
          ]}
        />
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No products match" : "No products yet"}
            text={
              filtered
                ? "Try another search or filter."
                : canEdit
                  ? "Add the first item — demands are raised against these."
                  : undefined
            }
            action={!filtered && canEdit ? { href: `${PATH}/new`, label: "Add product" } : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Unit</th>
                  {showAmounts && <th className="px-4 py-3 text-right">Purchase price</th>}
                  {showAmounts && <th className="px-4 py-3 text-right">Current price</th>}
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const noPrice = !p.current_price || Number(p.current_price) <= 0;
                  return (
                    <tr key={p.id} className="relative transition hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <ProductIcon kind={productKind({ name: p.product_name, category: p.category })} className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={`${PATH}/${p.id}`}
                              className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-blue-700"
                            >
                              {p.product_name}
                            </Link>
                            {p.description && (
                              <p className="max-w-xs truncate text-xs text-slate-500">{p.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.asset_type_id && fixed.has(p.asset_type_id) ? (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                            Fixed asset · {typeName.get(p.asset_type_id)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Consumable{p.asset_type_id ? ` · ${typeName.get(p.asset_type_id) ?? ""}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.category ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{p.unit}</td>
                      {showAmounts && (
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {formatMoney(p.purchase_price)}
                        </td>
                      )}
                      {showAmounts && (
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {noPrice ? (
                            <span className="text-amber-700">No price</span>
                          ) : (
                            <span className="font-medium text-slate-900">{formatMoney(p.current_price)}</span>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            p.is_active ? "text-emerald-700" : "text-slate-400"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                          />
                          {p.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {rows.length} product{rows.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
