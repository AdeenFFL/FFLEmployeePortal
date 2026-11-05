import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, fetchTicketScope, hasItPermission } from "@/lib/it/ticket-data";
import { cardClass, inputClass, secondaryButtonClass } from "../_components/ticket-ui";
import { TicketsSection } from "./_sections/tickets-section";
import { OnboardingSection } from "./_sections/onboarding-section";
import { SitesSection } from "./_sections/sites-section";

type Tab = "tickets" | "onboarding" | "sites";
const TABS: { key: Tab; label: string }[] = [
  { key: "tickets", label: "Tickets" },
  { key: "onboarding", label: "Onboarding Tasks" },
  { key: "sites", label: "Sites & IT Staff" },
];

// Unified IT Settings — replaces the old /it/settings/tickets, /it/settings/sites and
// /it/settings/owners pages (each now a thin redirect here, so nothing bookmarked breaks).
// Owner assignment lives inline on the category/task rows instead of its own tab.
export default async function ItSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; site?: string; q?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === "onboarding" ? "onboarding" : params.tab === "sites" ? "sites" : "tickets";
  const supabase = await createClient();

  const [
    scope,
    canEditTickets,
    canEditOnboarding,
    canReadOnboarding,
    orgUnits,
    { data: categories },
    { data: slas },
    { data: requestTypes },
    { data: siteStaff },
    { data: categoryOwnersRaw },
    { data: taskOwnersRaw },
    { data: itDepartmentStaff },
  ] = await Promise.all([
    fetchTicketScope(supabase),
    hasItPermission(supabase, "it.ticket_settings.update"),
    hasItPermission(supabase, "it.onboarding.assign"),
    hasItPermission(supabase, "it.onboarding.read"),
    fetchOrgUnits(supabase),
    supabase.schema("it").from("ticket_categories").select("*").order("sort_order").order("name").then(checked),
    supabase.schema("it").from("sla_policies").select("*").then(checked),
    supabase.schema("it").from("request_types").select("*").order("applies_to").order("name").then(checked),
    supabase.schema("it").rpc("list_site_it_staff").then(checked),
    supabase.schema("it").rpc("list_category_owners").then(checked),
    supabase.schema("it").rpc("list_task_type_owners").then(checked),
    supabase.schema("it").rpc("list_it_department_staff").then(checked),
  ]);

  const canReadTickets = scope.readAll || scope.siteIds.length > 0 || canEditTickets;
  const visibleSites =
    canEditTickets || scope.readAll ? orgUnits.sites : orgUnits.sites.filter((s) => scope.siteIds.includes(s.id));
  const siteId = params.site && visibleSites.some((s) => s.id === params.site) ? params.site : visibleSites[0]?.id;
  const siteName = siteId ? orgUnits.nameById.get(siteId) : undefined;

  const staffBySite = new Map<string, NonNullable<typeof siteStaff>>();
  for (const s of siteStaff ?? []) {
    staffBySite.set(s.site_id, [...(staffBySite.get(s.site_id) ?? []), s]);
  }
  const siteStaffCandidates = (staffBySite.get(siteId ?? "") ?? []).map((s) => ({
    personId: s.person_id,
    fullName: s.full_name,
  }));

  const categoryOwners = (categoryOwnersRaw ?? [])
    .filter((o) => o.site_id === siteId)
    .map((o) => ({ categoryId: o.category_id, personId: o.person_id, fullName: o.full_name, isPrimary: o.is_primary }));
  const taskOwners = (taskOwnersRaw ?? [])
    .filter((o) => o.site_id === siteId)
    .map((o) => ({ taskType: o.task_type, personId: o.person_id, fullName: o.full_name, isPrimary: o.is_primary }));

  const assignmentsByPerson = new Map<string, { siteId: string; siteName: string; role: "manager" | "member" }[]>();
  for (const s of siteStaff ?? []) {
    const entry = { siteId: s.site_id, siteName: orgUnits.nameById.get(s.site_id) ?? "—", role: s.role };
    assignmentsByPerson.set(s.person_id, [...(assignmentsByPerson.get(s.person_id) ?? []), entry]);
  }
  const sitesWithoutManager = orgUnits.sites.filter((s) => {
    const team = staffBySite.get(s.id) ?? [];
    return team.length > 0 && !team.some((m) => m.role === "manager");
  });

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`;

  return (
    <div className="py-6">
      <PageHeader
        title="IT Settings"
        description="SLA targets, request types, categories, owners, and sites & IT staff — all in one place."
        action={
          <Link href="/it/dashboard" className={secondaryButtonClass}>
            Dashboard
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <Link key={t.key} href={`/it/settings?tab=${t.key}${siteId ? `&site=${siteId}` : ""}`} className={tabClass(tab === t.key)}>
              {t.label}
            </Link>
          ))}
        </div>
        {tab !== "sites" && visibleSites.length > 0 && (
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
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
          </form>
        )}
      </div>

      {tab === "tickets" &&
        (canReadTickets ? (
          <TicketsSection
            slas={slas ?? []}
            requestTypes={requestTypes ?? []}
            categories={categories ?? []}
            canEdit={canEditTickets}
            siteId={siteId}
            siteName={siteName}
            canEditOwners={canEditTickets || scope.managedSiteIds.includes(siteId ?? "")}
            siteStaff={siteStaffCandidates}
            categoryOwners={categoryOwners}
          />
        ) : (
          <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
            You don&apos;t have access to ticket settings.
          </div>
        ))}

      {tab === "onboarding" &&
        (canReadOnboarding ? (
          <OnboardingSection
            siteId={siteId}
            siteName={siteName}
            canEdit={canEditOnboarding}
            siteStaff={siteStaffCandidates}
            taskOwners={taskOwners}
          />
        ) : (
          <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
            You don&apos;t have access to onboarding task settings.
          </div>
        ))}

      {tab === "sites" &&
        (canEditTickets || canReadTickets ? (
          <SitesSection
            itStaff={itDepartmentStaff ?? []}
            sites={orgUnits.sites}
            assignmentsByPerson={assignmentsByPerson}
            sitesWithoutManager={sitesWithoutManager}
            canEdit={canEditTickets}
          />
        ) : (
          <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
            You don&apos;t have access to sites &amp; IT staff.
          </div>
        ))}
    </div>
  );
}
