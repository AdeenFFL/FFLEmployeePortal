import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, fetchTicketScope, hasItPermission } from "@/lib/it/ticket-data";
import { formatMoney } from "@/lib/it/procurement";
import { createDemand } from "../actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../../_components/ticket-ui";

// PRC-04 Raise demand (BRD §5.5.1). Gated by it.demands.create. The site list is limited to the
// raiser's own site and the sites whose IT team they're on (all sites with read_all) — the
// database checks the same rule.
export default async function NewDemandPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; product?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [productsRes, { sites, departments }, scope, readAll, personRes] = await Promise.all([
    supabase
      .schema("it")
      .from("products")
      .select("id, product_name, category, unit, current_price, purchase_price, asset_type_id")
      .eq("is_active", true)
      .order("product_name"),
    fetchOrgUnits(supabase),
    fetchTicketScope(supabase),
    hasItPermission(supabase, "it.demands.read_all"),
    supabase.from("persons").select("site_id").eq("id", personId ?? "").maybeSingle(),
  ]);
  const products = checked(productsRes).data ?? [];
  const homeSite = personRes.data?.site_id ?? null;
  const allowedSites = readAll
    ? sites
    : sites.filter((s) => s.id === homeSite || scope.siteIds.includes(s.id));
  const defaultSite = allowedSites.find((s) => s.id === homeSite)?.id ?? allowedSites[0]?.id ?? "";

  return (
    <div className="py-6">
      <PageHeader
        title="Raise Demand"
        description="Request an item from the Product Master. Procurement categorises it and routes it for approval."
        action={
          <Link href="/it/procurement/demands" className={secondaryButtonClass}>
            Back to demands
          </Link>
        }
      />
      <FormMessage error={params.error} />

      {products.length === 0 ? (
        <p className={`${cardClass} p-6 text-sm text-slate-500`}>
          There are no active products yet. Ask procurement to add the item to the Product Master first.
        </p>
      ) : allowedSites.length === 0 ? (
        <p className={`${cardClass} p-6 text-sm text-slate-500`}>
          Your profile has no site and you&apos;re not on any site&apos;s IT team, so there&apos;s no
          site to raise a demand for. Ask an IT admin to add you on Sites &amp; IT Staff.
        </p>
      ) : (
        <form action={createDemand} className={`${cardClass} max-w-3xl space-y-5 p-6`}>
          <label className="block">
            <span className={labelClass}>
              Product <span className="text-red-500">*</span>
            </span>
            <select name="productId" required defaultValue={params.product ?? ""} className={inputClass}>
              <option value="" disabled>
                Choose a product…
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                  {p.category ? ` — ${p.category}` : ""} · per {p.unit} ·{" "}
                  {formatMoney(p.current_price ?? p.purchase_price)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Not in the list? Ask procurement to add it to the Product Master.
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className={labelClass}>
                Quantity <span className="text-red-500">*</span>
              </span>
              <input
                type="number"
                name="quantity"
                min={1}
                max={100000}
                step={1}
                required
                defaultValue={1}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>
                Department <span className="text-red-500">*</span>
              </span>
              <select name="departmentId" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose…
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>
                Site <span className="text-red-500">*</span>
              </span>
              <select name="siteId" required defaultValue={defaultSite} className={inputClass}>
                {allowedSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>
              Justification <span className="text-red-500">*</span>
            </span>
            <textarea
              name="justification"
              rows={4}
              required
              placeholder="Why is this needed, for whom, and by when?"
              className={inputClass}
            />
          </label>

          <p className="text-xs text-slate-400">
            The estimated price is taken from the Product Master when you submit. You&apos;ll get a
            notification as the demand moves along.
          </p>
          <button type="submit" className={primaryButtonClass}>
            Raise demand
          </button>
        </form>
      )}
    </div>
  );
}
