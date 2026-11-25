import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchOrgUnits, fetchTicketScope, hasItPermission } from "@/lib/it/ticket-data";
import { cardClass } from "../_components/ticket-ui";
import { TicketsSection } from "./_sections/tickets-section";
import { OnboardingSection } from "./_sections/onboarding-section";
import { SitesSection } from "./_sections/sites-section";
import { SiteSwitcher } from "./_sections/site-switcher";

type Tab = "tickets" | "onboarding" | "sites";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "tickets", label: "Tickets", hint: "SLA targets, request types and categories with their owners per site." },
  {
    key: "onboarding",
    label: "Onboarding tasks",
    hint: "Who each onboarding / offboarding task goes to at this site, and who runs the whole request.",
  },
  { key: "sites", label: "Sites & IT staff", hint: "Which sites each IT person covers, as manager or member." },
];
type TicketSection = "sla" | "types" | "categories";
const TICKET_SECTIONS: { key: TicketSection; label: string }[] = [
  { key: "sla", label: "SLA targets" },
  { key: "types", label: "Request types" },
  { key: "categories", label: "Categories & owners" },
];

// Unified IT Settings — replaces the old /it/settings/tickets, /it/settings/sites and
// /it/settings/owners pages (each now a thin redirect here, so nothing bookmarked breaks).
// Owner assignment lives inline on the category/task rows instead of its own tab.
export default async function ItSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; site?: string; q?: string; section?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === "onboarding" ? "onboarding" : params.tab === "sites" ? "sites" : "tickets";
  const section: TicketSection = TICKET_SECTIONS.find((t) => t.key === params.section)?.key ?? "sla";
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

  const siteParam = siteId ? `&site=${siteId}` : "";
  const tabHref = (t: Tab) => `/it/settings?tab=${t}${siteParam}`;
  const sectionHref = (sec: TicketSection) => `/it/settings?tab=tickets&section=${sec}${siteParam}`;
  // The site only matters where owners are shown.
  const showSite = (tab === "onboarding" || (tab === "tickets" && section === "categories")) && visibleSites.length > 0;

  return (
    <div className="py-6">
      <PageHeader title="IT Settings" description={TABS.find((t) => t.key === tab)?.hint} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <nav aria-label="Settings" className="flex gap-6">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-blue-600 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {showSite && (
          <div className="pb-2">
            <SiteSwitcher
              sites={visibleSites.map((s) => ({ id: s.id, name: s.name }))}
              siteId={siteId}
              baseQuery={tab === "tickets" ? `tab=tickets&section=${section}` : `tab=${tab}`}
            />
          </div>
        )}
      </div>

      {tab === "tickets" && canReadTickets && (
        <nav aria-label="Ticket settings" className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          {TICKET_SECTIONS.map((t) => (
            <Link
              key={t.key}
              href={sectionHref(t.key)}
              aria-current={section === t.key ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                section === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {tab === "tickets" &&
        (canReadTickets ? (
          <TicketsSection
            section={section}
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
