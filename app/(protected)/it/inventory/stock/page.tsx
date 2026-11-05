import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { fetchAssetPersonNames, fetchOrgUnits, hasItPermission } from "@/lib/it/ticket-data";
import { fixedAssetTypeIds, isFixedAsset } from "@/lib/it/stock";
import type { ItStockMovementType } from "@/types/database";
import { FormMessage, primaryButtonClass } from "../../_components/ticket-ui";
import { ProductIcon, productKind } from "../../procurement/_components/product-icon";
import { FormDrawer } from "../_components/drawer";
import { formatDate } from "../asset-status";
import { recordStockMovement } from "./actions";
import { MovementFields } from "./movement-fields";

const PATH = "/it/inventory/stock";
const RECENT = 40;

const MOVEMENT_STYLE: Record<ItStockMovementType, { label: string; cls: string }> = {
  Opening: { label: "Opening", cls: "bg-slate-100 text-slate-700" },
  Received: { label: "In", cls: "bg-emerald-50 text-emerald-700" },
  Issued: { label: "Issued", cls: "bg-blue-50 text-blue-700" },
  Adjustment: { label: "Adjusted", cls: "bg-amber-50 text-amber-800" },
};

// INV-07 Consumable stock (javaria_it_0022): what is on the shelf per product per site, what is
// running low, and every movement — stock in, issues (incl. consumable demands), adjustments.
// Deliveries of consumables add stock automatically; fixed assets live in the Asset Register.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{
    site?: string;
    q?: string;
    low?: string;
    product?: string;
    record?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [canRead, canUpdate] = await Promise.all([
    hasItPermission(supabase, "it.stock.read"),
    hasItPermission(supabase, "it.stock.update"),
  ]);
  if (!canRead) notFound();

  const [{ data: productRows }, fixedTypes, { sites, nameById: siteName }, levelsRes, movementsRes] = await Promise.all([
    supabase
      .schema("it")
      .from("products")
      .select("id, product_name, category, unit, asset_type_id, reorder_level, is_active")
      .order("product_name"),
    fixedAssetTypeIds(supabase),
    fetchOrgUnits(supabase),
    supabase.schema("it").from("stock_levels").select("product_id, site_id, on_hand, last_movement_at"),
    (() => {
      let q = supabase
        .schema("it")
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(RECENT);
      if (sp.product) q = q.eq("product_id", sp.product);
      if (sp.site) q = q.eq("site_id", sp.site);
      return q;
    })(),
  ]);

  // Before javaria_it_0022 is applied the ledger doesn't exist — say so instead of an empty page.
  if (levelsRes.error) {
    return (
      <div className="py-6">
        <PageHeader title="Stock" description="Consumable stock per site." />
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Stock isn&apos;t set up in the database yet (migration javaria_it_0022). {levelsRes.error.message}
        </p>
      </div>
    );
  }

  const consumables = (productRows ?? []).filter((p) => !isFixedAsset(p, fixedTypes));
  const productById = new Map(consumables.map((p) => [p.id, p]));
  const levels = levelsRes.data ?? [];
  const onHand = new Map(levels.map((l) => [`${l.product_id}:${l.site_id}`, l]));

  // One row per consumable per site in view. With one site (or a site filter) every active
  // consumable shows, so "never stocked" items are visible too; otherwise only sites with stock.
  const siteIds = sp.site
    ? [sp.site]
    : sites.length === 1
      ? [sites[0].id]
      : [...new Set(levels.map((l) => l.site_id))];
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = siteIds
    .flatMap((siteId) =>
      consumables
        .filter((p) => p.is_active || onHand.has(`${p.id}:${siteId}`))
        .map((p) => {
          const level = onHand.get(`${p.id}:${siteId}`);
          const qty = level?.on_hand ?? 0;
          const state: "out" | "low" | "ok" =
            qty <= 0 ? "out" : p.reorder_level !== null && qty <= p.reorder_level ? "low" : "ok";
          return { product: p, siteId, qty, state, last: level?.last_movement_at ?? null };
        }),
    )
    .filter((r) => !q || r.product.product_name.toLowerCase().includes(q) || (r.product.category ?? "").toLowerCase().includes(q))
    .filter((r) => sp.low !== "1" || r.state !== "ok")
    .sort((a, b) => ({ out: 0, low: 1, ok: 2 })[a.state] - ({ out: 0, low: 1, ok: 2 })[b.state] || a.product.product_name.localeCompare(b.product.product_name));

  const lowCount = rows.filter((r) => r.state === "low").length;
  const outCount = rows.filter((r) => r.state === "out" && r.last).length;
  const totalUnits = rows.reduce((n, r) => n + Math.max(0, r.qty), 0);

  const movements = movementsRes.data ?? [];
  const names = await fetchAssetPersonNames(
    supabase,
    movements.flatMap((m) => [m.issued_to_person_id, m.created_by]),
  );

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { site: sp.site, q: sp.q, low: sp.low, product: sp.product, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${PATH}?${s}` : PATH;
  };
  const recordType = (["Received", "Issued", "Adjustment", "Opening"] as const).find((t) => t === sp.record);
  const filterProduct = sp.product ? productById.get(sp.product) : undefined;

  return (
    <div className="py-6">
      <PageHeader
        title="Stock"
        description="Consumables on the shelf per site. Deliveries add stock automatically; issues and consumable demands take it out."
        action={
          canUpdate ? (
            <Link href={href({ record: "Received" })} className={primaryButtonClass}>
              + Record movement
            </Link>
          ) : undefined
        }
      />
      <FormMessage error={sp.error} notice={sp.notice} />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Tile label="Items in stock" value={totalUnits} dot="bg-blue-500" />
        <Tile label="Running low" value={lowCount} dot="bg-amber-500" href={href({ low: "1" })} />
        <Tile label="Out of stock" value={outCount} dot="bg-red-500" href={href({ low: "1" })} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form method="get" className="relative min-w-[16rem] flex-1">
          {sp.site && <input type="hidden" name="site" value={sp.site} />}
          {sp.low && <input type="hidden" name="low" value={sp.low} />}
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
            defaultValue={sp.q ?? ""}
            placeholder="Search consumables — press Enter"
            aria-label="Search consumables"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </form>
        {sites.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {[{ id: "", name: "All sites" }, ...sites].map((s) => (
              <Link
                key={s.id || "all"}
                href={href({ site: s.id || undefined })}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  (sp.site ?? "") === s.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}
        <Link
          href={href({ low: sp.low === "1" ? undefined : "1" })}
          className={`rounded-full border px-3 py-1.5 text-sm ${
            sp.low === "1" ? "border-amber-600 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          Needs attention
        </Link>
      </div>

      <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            {consumables.length === 0
              ? "No consumable products yet — add them under Procurement → Products (no asset type, or a Consumable type)."
              : siteIds.length === 0
                ? "Nothing in stock yet. Record an opening balance to start."
                : "Nothing matches."}
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Product</th>
                {siteIds.length > 1 && <th className="px-4 py-3">Site</th>}
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Reorder at</th>
                <th className="px-4 py-3">Last movement</th>
                {canUpdate && <th className="px-5 py-3 text-right">Quick action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.product.id}:${r.siteId}`} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <ProductIcon
                          kind={productKind({ name: r.product.product_name, category: r.product.category })}
                          className="h-5 w-5"
                        />
                      </span>
                      <div>
                        <Link
                          href={href({ product: r.product.id, site: r.siteId })}
                          className="font-medium text-slate-900 hover:text-blue-700"
                        >
                          {r.product.product_name}
                        </Link>
                        <p className="text-xs text-slate-500">{r.product.category ?? `per ${r.product.unit}`}</p>
                      </div>
                    </div>
                  </td>
                  {siteIds.length > 1 && <td className="px-4 py-3 text-slate-600">{siteName.get(r.siteId) ?? "—"}</td>}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        r.state === "out" ? "text-red-700" : r.state === "low" ? "text-amber-700" : "text-slate-900"
                      }`}
                    >
                      {r.qty}
                    </span>{" "}
                    <span className="text-xs text-slate-500">{r.product.unit}</span>
                    {r.state !== "ok" && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          r.state === "out" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {r.state === "out" ? "Out" : "Low"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{r.product.reorder_level ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{r.last ? formatDate(r.last) : "Never stocked"}</td>
                  {canUpdate && (
                    <td className="whitespace-nowrap px-5 py-3 text-right text-sm">
                      <Link
                        href={href({ record: "Received", product: r.product.id, site: r.siteId })}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        Add
                      </Link>
                      {r.qty > 0 && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          <Link
                            href={href({ record: "Issued", product: r.product.id, site: r.siteId })}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Issue
                          </Link>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Movements
            {filterProduct && <span className="font-normal text-slate-500"> · {filterProduct.product_name}</span>}
          </h2>
          {sp.product && (
            <Link href={href({ product: undefined })} className="text-sm text-slate-500 hover:text-slate-800">
              Show all products
            </Link>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {movements.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">No movements yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-5 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => {
                  const product = productById.get(m.product_id);
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(m.movement_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-slate-900">{product?.product_name ?? "—"}</span>
                        {sites.length > 1 && (
                          <span className="block text-xs text-slate-500">{siteName.get(m.site_id) ?? ""}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLE[m.movement_type].cls}`}>
                          {MOVEMENT_STYLE[m.movement_type].label}
                        </span>
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                          m.quantity > 0 ? "text-emerald-700" : "text-slate-900"
                        }`}
                      >
                        {m.quantity > 0 ? `+${m.quantity}` : `−${Math.abs(m.quantity)}`}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {m.issued_to_person_id && <span className="block">To {names.get(m.issued_to_person_id) ?? "—"}</span>}
                        {m.demand_id && (
                          <Link href={`/it/procurement/demands/${m.demand_id}`} className="text-xs font-medium text-blue-700 hover:underline">
                            Open demand
                          </Link>
                        )}
                        {m.reason && <span className="block text-xs text-slate-500">{m.reason}</span>}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{(m.created_by && names.get(m.created_by)) || "System"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {canUpdate && recordType && (
        <FormDrawer
          key={`${recordType}:${sp.product ?? ""}:${sp.site ?? ""}`}
          closeHref={href({ record: undefined })}
          title="Record stock movement"
          description="Stock can't go below zero — the save is refused if there isn't enough."
          action={recordStockMovement}
          submitLabel="Save"
        >
          <MovementFields
            products={consumables
              .filter((p) => p.is_active)
              .map((p) => ({ id: p.id, name: p.product_name, unit: p.unit }))}
            sites={sites.map((s) => ({ id: s.id, name: s.name }))}
            defaultType={recordType}
            defaultProduct={sp.product && productById.has(sp.product) ? sp.product : ""}
            defaultSite={sp.site ?? (sites.length === 1 ? sites[0].id : "")}
            onHand={Object.fromEntries(levels.map((l) => [`${l.product_id}:${l.site_id}`, l.on_hand]))}
          />
        </FormDrawer>
      )}
    </div>
  );
}

function Tile({ label, value, dot, href }: { label: string; value: number; dot: string; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="mt-1 block text-xl font-semibold tabular-nums text-slate-900">{value}</span>
    </>
  );
  const cls = "block rounded-xl border border-slate-200 bg-white px-4 py-3";
  return href ? (
    <Link href={href} className={`${cls} hover:border-slate-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
