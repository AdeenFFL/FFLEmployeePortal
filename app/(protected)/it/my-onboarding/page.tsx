import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { fetchPersonNames } from "@/lib/it/ticket-data";
import { CHECKLIST_STATUS_TONE, LIFECYCLE_STATUS_TONE } from "@/lib/it/onboarding";
import { formatDate } from "@/lib/it/tickets";
import { addLifecycleUpdate, confirmOnboarding } from "../onboarding/actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  Timeline,
} from "../_components/ticket-ui";

// ONB-03 — the new joiner's view (BRD §5.1.13, gap 4.1 #11 "no employee status visibility").
// RLS shows a person only their own *onboarding* requests, never an offboarding record.
export default async function MyOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const { data: requests } = await supabase
    .schema("it")
    .from("onboarding_offboarding")
    .select("*")
    .eq("kind", "Onboarding")
    .eq("person_id", personId ?? "")
    .order("created_at", { ascending: false });

  const rows = requests ?? [];
  const ids = rows.map((r) => r.id);

  const [{ data: items }, { data: updates }] = await Promise.all([
    ids.length
      ? supabase
          .schema("it")
          .from("checklist_items")
          .select("id, request_id, task_name, status, assigned_to_person_id, sort_order")
          .in("request_id", ids)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .schema("it")
          .from("onboarding_updates")
          .select("*")
          .in("request_id", ids)
          .eq("is_internal", false)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const names = await fetchPersonNames(supabase, [
    ...rows.map((r) => r.it_executive_person_id),
    ...(items ?? []).map((i) => i.assigned_to_person_id),
    ...(updates ?? []).map((u) => u.author_person_id),
  ]);

  return (
    <div className="py-6">
      <PageHeader
        title="My Onboarding"
        description="Track IT's preparation for your first day and confirm everything works."
      />
      <FormMessage error={error} notice={notice} />

      {rows.length === 0 && (
        <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
          There&apos;s no onboarding request linked to your account.
        </div>
      )}

      <div className="space-y-6">
        {rows.map((r) => {
          const checklist = (items ?? []).filter((i) => i.request_id === r.id);
          const timeline = (updates ?? []).filter((u) => u.request_id === r.id);
          const awaiting = r.status === "Awaiting Confirmation";
          return (
            <section key={r.id} className={`${cardClass} p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{r.request_number}</h2>
                  <p className="text-sm text-slate-500">
                    Joining {formatDate(r.joining_date)}
                    {r.it_executive_person_id &&
                      ` · IT contact: ${names.get(r.it_executive_person_id) ?? "IT Team"}`}
                  </p>
                </div>
                <StatusPill label={r.status} tone={LIFECYCLE_STATUS_TONE[r.status]} />
              </div>

              <ul className="mb-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {checklist.map((i) => (
                  <li key={i.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700">{i.task_name}</span>
                    <StatusPill label={i.status} tone={CHECKLIST_STATUS_TONE[i.status]} />
                  </li>
                ))}
              </ul>

              {awaiting && (
                <form
                  action={confirmOnboarding.bind(null, r.id)}
                  className="mb-6 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4"
                >
                  <p className="text-sm font-semibold text-blue-900">
                    Please confirm what&apos;s working
                  </p>
                  <div className="grid gap-2 text-sm text-slate-800 sm:grid-cols-2">
                    {r.email_required && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="emailOk" className="h-4 w-4" />
                        My company email account works
                      </label>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="accessOk" className="h-4 w-4" />
                      I have the system access I need
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="softwareOk" className="h-4 w-4" />
                      My software is installed
                    </label>
                    {r.laptop_required && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="assetOk" className="h-4 w-4" />
                        I received my laptop / equipment
                      </label>
                    )}
                  </div>
                  <textarea
                    name="notes"
                    rows={2}
                    placeholder="Anything missing or not working? Tell IT here."
                    aria-label="Notes for IT"
                    className={inputClass}
                  />
                  <button type="submit" className={primaryButtonClass}>
                    Submit confirmation
                  </button>
                </form>
              )}

              <h3 className="mb-3 text-sm font-semibold text-slate-900">Updates</h3>
              <Timeline updates={timeline} names={names} />

              {r.status !== "Closed" && r.status !== "Cancelled" && (
                <form
                  action={addLifecycleUpdate.bind(null, r.id)}
                  className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4"
                >
                  <input type="hidden" name="returnTo" value="my" />
                  <textarea
                    name="body"
                    required
                    rows={2}
                    placeholder="Message IT about your onboarding…"
                    aria-label="Message"
                    className={inputClass}
                  />
                  <button type="submit" className={`${secondaryButtonClass} self-start`}>
                    Send
                  </button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
