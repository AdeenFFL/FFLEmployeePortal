import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, fetchTicketScope, hasItPermission } from "@/lib/it/ticket-data";
import { DEMAND_CATEGORIES } from "@/lib/it/procurement";
import { createDemand } from "../actions";
import { DemandForm } from "./demand-form";
import {
  cardClass,
  FormMessage,
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

  const [productsRes, { sites, departments }, scope, readAll, personRes, canAddProducts, approversRes, canManageApprovers, settingsRes] =
    await Promise.all([
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
    hasItPermission(supabase, "it.products.update"),
    supabase.schema("it").rpc("list_department_approvers"),
    hasItPermission(supabase, "it.procurement_settings.update"),
    supabase.schema("it").from("procurement_settings").select("consumable_path_enabled").eq("id", true).maybeSingle(),
  ]);
  const products = checked(productsRes).data ?? [];
  const homeSite = personRes.data?.site_id ?? null;
  const allowedSites = readAll
    ? sites
    : sites.filter((s) => s.id === homeSite || scope.siteIds.includes(s.id));
  // Who each department's demands go to (approvers whose role holds Approve Demands).
  const approversByDept: Record<string, string[]> = {};
  for (const a of approversRes.data ?? []) {
    if (a.can_approve_demands && a.has_permission) {
      (approversByDept[a.department_id] ??= []).push(a.full_name);
    }
  }
  const defaultSite = allowedSites.find((s) => s.id === homeSite)?.id ?? allowedSites[0]?.id ?? "";

  return (
    <div className="py-6">
      <PageHeader
        title="Raise Demand"
        description="Pick the item, say how many and why — the summary shows what it costs and who approves it."
        action={
          <Link href="/it/procurement/demands" className={secondaryButtonClass}>
            Back to demands
          </Link>
        }
      />
      <FormMessage error={params.error} />

      {products.length === 0 ? (
        <div className={`${cardClass} p-6 text-sm text-slate-500`}>
          <p>There are no active products yet — a demand is always for an item from the Product Master.</p>
          {canAddProducts ? (
            <Link href="/it/procurement/products" className={`${primaryButtonClass} mt-4 inline-block`}>
              Add products
            </Link>
          ) : (
            <p className="mt-1">Ask procurement to add the item to the Product Master first.</p>
          )}
        </div>
      ) : allowedSites.length === 0 ? (
        <p className={`${cardClass} p-6 text-sm text-slate-500`}>
          Your profile has no site and you&apos;re not on any site&apos;s IT team, so there&apos;s no
          site to raise a demand for. Ask an IT admin to add you on Sites &amp; IT Staff.
        </p>
      ) : (
        <DemandForm
          action={createDemand}
          products={products.map((p) => ({
            id: p.id,
            name: p.product_name,
            category: p.category,
            unit: p.unit,
            price: p.current_price ?? p.purchase_price,
            fixedAsset: Boolean(p.asset_type_id),
          }))}
          categories={DEMAND_CATEGORIES}
          departments={departments}
          sites={allowedSites}
          defaultSite={defaultSite}
          defaultProduct={params.product}
          approvers={approversByDept}
          consumablePath={settingsRes.data?.consumable_path_enabled ?? true}
          canManageApprovers={canManageApprovers}
          canAddProducts={canAddProducts}
        />
      )}
    </div>
  );
}
