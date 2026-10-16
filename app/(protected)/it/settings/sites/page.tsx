import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchOrgUnits } from "@/lib/it/ticket-data";
import { addSiteStaff, removeSiteStaff, setHqSite, setSiteStaffRole } from "./actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../_components/ticket-ui";

const linkButton = "text-sm font-medium text-blue-700 hover:underline";

// Sites & IT staff (plan 08 Phase 6.1). Each site's IT team sees only that site's tickets;
// managers assign within the site and can Transfer to HQ. Gated by it.ticket_settings.update.
export default async function SitesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; site?: string; q?: string }>;
}) {
  const { notice, error, site: activeSite, q } = await searchParams;
  const supabase = await createClient();

  const [{ data: settings }, { data: staff }, { sites }, { data: candidates }] = await Promise.all([
    supabase.schema("it").from("settings").select("hq_site_id").eq("id", true).maybeSingle().then(checked),
    supabase.schema("it").rpc("list_site_it_staff").then(checked),
    fetchOrgUnits(supabase),
    activeSite && q?.trim()
      ? supabase.schema("it").rpc("search_employees", { p_search: q })
      : Promise.resolve({ data: null }),
  ]);

  const hqSiteId = settings?.hq_site_id ?? null;
  const staffBySite = new Map<string, NonNullable<typeof staff>>();
  for (const s of staff ?? []) {
    staffBySite.set(s.site_id, [...(staffBySite.get(s.site_id) ?? []), s]);
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Sites & IT Staff"
        description="Who handles each site's IT tickets. Site IT teams only see their own site's tickets."
        action={
          <Link href="/it/settings/tickets" className={secondaryButtonClass}>
            Ticket Settings
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      <section className={`${cardClass} mb-6 p-6`}>
        <h2 className="text-base font-semibold text-slate-900">HQ site</h2>
        <p className="mb-4 text-sm text-slate-500">
          Tickets whose request type or category is marked <strong>Handled by HQ</strong> (e.g.
          email, SAP / ERP access), and tickets from employees with no site, go to this site&apos;s
          IT team. Onboarding routing uses it too.
        </p>
        {sites.length === 0 ? (
          <p className="text-sm text-amber-700">
            No sites exist yet. Add them under Administration → Sites first.
          </p>
        ) : (
          <form action={setHqSite} className="flex flex-wrap items-end gap-3">
            <label className="min-w-64">
              <span className={labelClass}>HQ site</span>
              <select name="hqSiteId" defaultValue={hqSiteId ?? ""} className={inputClass}>
                <option value="">Not set</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </form>
        )}
        {!hqSiteId && sites.length > 0 && (
          <p className="mt-3 text-sm text-amber-700">
            Until an HQ site is set, HQ-handled tickets are visible only to HQ IT Executives.
          </p>
        )}
      </section>

      <div className="space-y-4">
        {sites.map((site) => {
          const team = staffBySite.get(site.id) ?? [];
          const managers = team.filter((t) => t.role === "manager");
          const isActive = activeSite === site.id;
          return (
            <section key={site.id} className={`${cardClass} p-6`} id={`site-${site.id}`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">{site.name}</h2>
                {site.id === hqSiteId && <StatusPill label="HQ" tone="info" />}
                {team.length > 0 && managers.length === 0 && (
                  <StatusPill label="No manager — new tickets go to HQ" tone="warning" />
                )}
              </div>

              {team.length === 0 ? (
                <p className="mb-3 text-sm text-slate-400">
                  No IT staff yet. Until someone is added, only HQ IT Executives see this site&apos;s
                  tickets.
                </p>
              ) : (
                <ul className="mb-3 divide-y divide-slate-100">
                  {team.map((member) => (
                    <li key={member.person_id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 text-sm text-slate-800">
                        {member.full_name}
                        {member.designation && (
                          <span className="ml-1 text-xs text-slate-400">· {member.designation}</span>
                        )}
                      </span>
                      <StatusPill
                        label={member.role === "manager" ? "Manager" : "Member"}
                        tone={member.role === "manager" ? "info" : "neutral"}
                      />
                      <form
                        action={setSiteStaffRole.bind(
                          null,
                          site.id,
                          member.person_id,
                          member.role === "manager" ? "member" : "manager",
                        )}
                      >
                        <button type="submit" className={linkButton}>
                          {member.role === "manager" ? "Make member" : "Make manager"}
                        </button>
                      </form>
                      <form action={removeSiteStaff.bind(null, site.id, member.person_id)}>
                        <button type="submit" className="text-sm text-slate-500 hover:text-red-600">
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rounded-lg bg-slate-50 p-3">
                <form method="get" className="flex flex-wrap gap-2">
                  <input type="hidden" name="site" value={site.id} />
                  <input
                    name="q"
                    defaultValue={isActive ? (q ?? "") : ""}
                    placeholder="Add IT staff: search name or employee code"
                    aria-label={`Search people to add to ${site.name}`}
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <button type="submit" className={secondaryButtonClass}>
                    Search
                  </button>
                </form>
                {isActive && q?.trim() && (
                  <form action={addSiteStaff.bind(null, site.id)} className="mt-3 space-y-2">
                    {(candidates ?? []).length === 0 ? (
                      <p className="text-xs text-slate-400">No employee matches “{q}”.</p>
                    ) : (
                      <>
                        {(candidates ?? []).map((c) => (
                          <label key={c.person_id} className="flex items-center gap-2 text-sm">
                            <input type="radio" name="personId" value={c.person_id} required />
                            {c.full_name}
                            <span className="text-xs text-slate-400">
                              {[c.employee_code, c.designation].filter(Boolean).join(" · ")}
                            </span>
                          </label>
                        ))}
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <select name="role" defaultValue="member" aria-label="Role" className={`${inputClass} w-auto`}>
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                          </select>
                          <button type="submit" className={primaryButtonClass}>
                            Add to {site.name}
                          </button>
                        </div>
                      </>
                    )}
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        People also need the IT ticket permissions on their role (Administration → Roles):{" "}
        <code>it.tickets.read</code> to see the queue, <code>it.tickets.update</code> to work
        tickets. HQ IT Executives additionally hold <code>it.tickets.read_all</code> and{" "}
        <code>it.tickets.assign</code>.
      </p>
    </div>
  );
}
