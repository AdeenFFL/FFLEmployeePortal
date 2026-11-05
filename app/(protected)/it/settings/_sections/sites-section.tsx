import Link from "next/link";
import { SiteAssignmentChips, type SiteAssignment, type SiteCandidate } from "@/components/site-assignment-chips";
import { StatusPill } from "@/components/status-pill";
import { assignSiteToStaff, removeSiteAssignment, setSiteAssignmentRole } from "../actions";
import { cardClass } from "../../_components/ticket-ui";

type Site = { id: string; name: string };
type ItStaffPerson = { person_id: string; full_name: string; designation: string | null };

// Person-centric (IT Module: department-based IT staff) — the eligible pool is automatic
// (everyone in the IT department, via it.list_it_department_staff), so there's no more
// search-and-add flow: just assign each of them one or more sites, each with a Manager/Member
// role. it.site_it_staff's own trigger (0054_it_department_based_staff.sql) is the real
// enforcement that keeps non-IT people out, regardless of how a row gets written.
export function SitesSection({
  itStaff,
  sites,
  assignmentsByPerson,
  sitesWithoutManager,
  canEdit,
}: {
  itStaff: ItStaffPerson[];
  sites: Site[];
  assignmentsByPerson: Map<string, SiteAssignment[]>;
  sitesWithoutManager: Site[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      {itStaff.length === 0 ? (
        <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
          Nobody is in the IT department yet — set a person&apos;s Department to &quot;IT&quot; on{" "}
          <Link href="/admin/users" className="font-medium text-blue-700 hover:underline">
            Admin → Users
          </Link>{" "}
          to make them eligible for site assignment here.
        </div>
      ) : (
        <section className={cardClass}>
          <ul className="divide-y divide-slate-100 px-6">
            {itStaff.map((person) => {
              const assignments = assignmentsByPerson.get(person.person_id) ?? [];
              const available: SiteCandidate[] = sites
                .filter((s) => !assignments.some((a) => a.siteId === s.id))
                .map((s) => ({ siteId: s.id, siteName: s.name }));
              return (
                <li key={person.person_id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-56 shrink-0 text-sm font-medium text-slate-900">
                    {person.full_name}
                    {person.designation && (
                      <span className="block text-xs font-normal text-slate-400">{person.designation}</span>
                    )}
                  </span>
                  <SiteAssignmentChips
                    assignments={assignments}
                    available={available}
                    canEdit={canEdit}
                    onAdd={assignSiteToStaff.bind(null, person.person_id)}
                    onRemove={removeSiteAssignment.bind(null, person.person_id)}
                    onSetRole={setSiteAssignmentRole.bind(null, person.person_id)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sitesWithoutManager.length > 0 && (
        <section className={`${cardClass} p-4`}>
          <p className="text-sm text-slate-500">
            <StatusPill label="No manager" tone="warning" /> sites below have no manager assigned —
            new tickets there go to HQ IT Executives instead:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {sitesWithoutManager.map((s) => (
              <li key={s.id} className="text-sm text-slate-700">
                {s.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-slate-400">
        People also need the IT ticket permissions on their role (
        <Link href="/admin/roles" className="underline">
          Administration → Roles
        </Link>
        ): <code>it.tickets.read</code> to see the queue, <code>it.tickets.update</code> to work
        tickets. HQ IT Executives additionally hold <code>it.tickets.read_all</code> and{" "}
        <code>it.tickets.assign</code>.
      </p>
    </div>
  );
}
