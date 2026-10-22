import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checked, fetchPersonNames } from "@/lib/it/ticket-data";
import { LIFECYCLE_STATUS_TONE } from "@/lib/it/onboarding";
import { formatDate } from "@/lib/it/tickets";
import { addLifecycleUpdate } from "../onboarding/actions";
import {
  cardClass,
  FormMessage,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  Timeline,
} from "../_components/ticket-ui";

// ONB-03 counterpart for self-filed offboarding (IT module revision, Phase 5). RLS shows a
// person only offboarding requests THEY filed (requested_by = current_person_id()) — an
// HR-initiated offboarding naming them as the leaving employee stays hidden here on purpose
// (0027_it_onboarding_offboarding.sql's own comment: it can be a termination).
export default async function MyOffboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const { data: requests } = checked(
    await supabase
      .schema("it")
      .from("onboarding_offboarding")
      .select("*")
      .eq("kind", "Offboarding")
      .eq("requested_by", personId ?? "")
      .order("created_at", { ascending: false }),
  );

  const rows = requests ?? [];
  const ids = rows.map((r) => r.id);

  const { data: updates } = ids.length
    ? await supabase
        .schema("it")
        .from("onboarding_updates")
        .select("*")
        .in("request_id", ids)
        .eq("is_internal", false)
        .order("created_at")
    : { data: [] };

  const names = await fetchPersonNames(supabase, [
    ...rows.map((r) => r.it_executive_person_id),
    ...(updates ?? []).map((u) => u.author_person_id),
  ]);

  return (
    <div className="py-6">
      <PageHeader
        title="My Offboarding"
        description="Your own resignation / offboarding requests and their progress with IT."
        action={
          <Link href="/it/my-offboarding/new" className={primaryButtonClass}>
            + New request
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      {rows.length === 0 && (
        <div className={`${cardClass} px-6 py-10 text-center text-sm text-slate-400`}>
          You haven&apos;t submitted an offboarding request.
        </div>
      )}

      <div className="space-y-6">
        {rows.map((r) => {
          const timeline = (updates ?? []).filter((u) => u.request_id === r.id);
          return (
            <section key={r.id} className={`${cardClass} p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{r.request_number}</h2>
                  <p className="text-sm text-slate-500">
                    Last working day {formatDate(r.last_working_date)}
                    {r.it_executive_person_id &&
                      ` · IT contact: ${names.get(r.it_executive_person_id) ?? "IT Team"}`}
                  </p>
                </div>
                <StatusPill label={r.status} tone={LIFECYCLE_STATUS_TONE[r.status]} />
              </div>

              <h3 className="mb-3 text-sm font-semibold text-slate-900">Updates</h3>
              <Timeline updates={timeline} names={names} />

              {r.status !== "Closed" && r.status !== "Cancelled" && (
                <form
                  action={addLifecycleUpdate.bind(null, r.id)}
                  className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4"
                >
                  <input type="hidden" name="returnTo" value="my-offboarding" />
                  <textarea
                    name="body"
                    required
                    rows={2}
                    placeholder="Message IT about your offboarding…"
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
