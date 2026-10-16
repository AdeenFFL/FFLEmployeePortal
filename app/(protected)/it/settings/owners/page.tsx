import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  checked,
  fetchCategoryMaps,
  fetchOrgUnits,
  fetchTicketScope,
  hasItPermission,
} from "@/lib/it/ticket-data";
import { addCategoryOwner, removeCategoryOwner, setPrimaryOwner } from "./actions";
import { cardClass, FormMessage, inputClass, secondaryButtonClass } from "../../_components/ticket-ui";

const smallSelect =
  "rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-blue-500";

// Category owners (plan 08 Phase 6.2). A ticket routed to a site auto-assigns to the ★ primary
// owner of its subcategory there (else its category); other owners get an FYI. IT settings
// admins edit any site; a site's IT managers edit their own site; other IT staff can look.
export default async function CategoryOwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [scope, isSettingsAdmin, orgUnits, maps, { data: owners }, { data: staff }] =
    await Promise.all([
      fetchTicketScope(supabase),
      hasItPermission(supabase, "it.ticket_settings.update"),
      fetchOrgUnits(supabase),
      fetchCategoryMaps(supabase),
      supabase.schema("it").rpc("list_category_owners").then(checked),
      supabase.schema("it").rpc("list_site_it_staff").then(checked),
    ]);

  // Sites this viewer can open: everyone sees the sites they belong to; admins / HQ see all.
  const visibleSites =
    isSettingsAdmin || scope.readAll
      ? orgUnits.sites
      : orgUnits.sites.filter((s) => scope.siteIds.includes(s.id));
  const siteId =
    params.site && visibleSites.some((s) => s.id === params.site) ? params.site : visibleSites[0]?.id;
  const canEdit = Boolean(siteId) && (isSettingsAdmin || scope.managedSiteIds.includes(siteId!));

  const siteStaff = (staff ?? []).filter((s) => s.site_id === siteId);
  const siteOwners = (owners ?? []).filter((o) => o.site_id === siteId);
  const ownersOf = (categoryId: string) => siteOwners.filter((o) => o.category_id === categoryId);

  const activeCategories = maps.categories.filter((c) => c.is_active);
  const topLevel = activeCategories.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => activeCategories.filter((c) => c.parent_id === id);

  // A render helper (not a nested component), so React doesn't re-create a component type on
  // every render.
  function ownerRow(categoryId: string, name: string, indent = false) {
    const rowOwners = ownersOf(categoryId);
    const available = siteStaff.filter((s) => !rowOwners.some((o) => o.person_id === s.person_id));
    return (
      <li key={categoryId} className={`flex flex-wrap items-center gap-2 py-2 ${indent ? "pl-6" : ""}`}>
        <span className={`w-56 shrink-0 text-sm ${indent ? "text-slate-700" : "font-medium text-slate-900"}`}>
          {name}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {rowOwners.length === 0 && (
            <span className="text-xs text-slate-400">
              {indent ? "Uses the category's owners" : "No owner — goes to the site manager"}
            </span>
          )}
          {rowOwners.map((o) => (
            <span
              key={o.person_id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
            >
              {o.is_primary && <span aria-label="Primary owner">★</span>}
              {o.full_name}
              {canEdit && !o.is_primary && (
                <form action={setPrimaryOwner.bind(null, siteId!, categoryId, o.person_id)} className="inline">
                  <button type="submit" title="Make primary" className="ml-1 text-slate-400 hover:text-amber-600">
                    ☆
                  </button>
                </form>
              )}
              {canEdit && (
                <form action={removeCategoryOwner.bind(null, siteId!, categoryId, o.person_id)} className="inline">
                  <button
                    type="submit"
                    aria-label={`Remove ${o.full_name}`}
                    className="ml-1 text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
        {canEdit && available.length > 0 && (
          <form action={addCategoryOwner.bind(null, siteId!, categoryId)} className="flex items-center gap-2">
            <select name="personId" defaultValue="" required aria-label={`Add owner for ${name}`} className={smallSelect}>
              <option value="" disabled>
                Add owner…
              </option>
              {available.map((s) => (
                <option key={s.person_id} value={s.person_id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" name="primary" defaultChecked={!rowOwners.some((o) => o.is_primary)} />
              ★ primary
            </label>
            <button type="submit" className="text-sm font-medium text-blue-700 hover:underline">
              Add
            </button>
          </form>
        )}
      </li>
    );
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Category Owners"
        description="Who a site's tickets auto-assign to, by category. ★ = primary owner (gets the ticket); other owners get an FYI."
        action={
          <Link href="/it/settings/sites" className={secondaryButtonClass}>
            Sites &amp; IT staff
          </Link>
        }
      />
      <FormMessage error={params.error} notice={params.notice} />

      {visibleSites.length === 0 ? (
        <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
          You&apos;re not on any site&apos;s IT team. Sites and their IT staff are set up on Sites &amp; IT staff.
        </div>
      ) : (
        <>
          <form method="get" className={`${cardClass} mb-6 flex flex-wrap items-center gap-3 p-4`}>
            <label htmlFor="site" className="text-sm font-medium text-slate-700">
              Site
            </label>
            <select id="site" name="site" defaultValue={siteId} className={`${inputClass} w-auto`}>
              {visibleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className={secondaryButtonClass}>
              Show
            </button>
            {!canEdit && <StatusPill label="View only" tone="neutral" />}
            {canEdit && siteStaff.length === 0 && (
              <span className="text-sm text-amber-700">
                This site has no IT staff yet — add them on Sites &amp; IT staff first.
              </span>
            )}
          </form>

          <div className="space-y-4">
            {topLevel.map((category) => (
              <section key={category.id} className={`${cardClass} px-6 py-2`}>
                <ul className="divide-y divide-slate-100">
                  {ownerRow(category.id, category.name)}
                  {childrenOf(category.id).map((sub) => ownerRow(sub.id, sub.name, true))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
