import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { checked, fetchCategoryMaps } from "@/lib/it/ticket-data";
import { formatDate } from "@/lib/it/tickets";
import {
  cardClass,
  FormMessage,
  PriorityBadge,
  primaryButtonClass,
  StatusBadge,
} from "../_components/ticket-ui";

// SCR-02 — tickets the employee raised (or that were raised for them).
export default async function MyItTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [{ data: tickets }, { categoryNameById }, { count: onboardingCount }] = await Promise.all([
    supabase
      .schema("it")
      .from("tickets")
      .select("id, ticket_number, subject, category_id, priority, status, created_at")
      .or(`requester_person_id.eq.${personId},requested_for_person_id.eq.${personId}`)
      .order("created_at", { ascending: false })
      .then(checked),
    fetchCategoryMaps(supabase),
    // New joiners get a pointer to /it/my-onboarding (not a permanent nav item for everyone).
    supabase
      .schema("it")
      .from("onboarding_offboarding")
      .select("id", { count: "exact", head: true })
      .eq("kind", "Onboarding")
      .eq("person_id", personId ?? ""),
  ]);

  const rows = tickets ?? [];

  return (
    <div className="py-6">
      <PageHeader
        title="My IT Tickets"
        description="Raise an IT support request and track its progress."
        action={
          <Link href="/it/my-tickets/new" className={primaryButtonClass}>
            Raise IT Ticket
          </Link>
        }
      />
      <FormMessage error={error} notice={notice} />

      {(onboardingCount ?? 0) > 0 && (
        <Link
          href="/it/my-onboarding"
          className="mb-6 block rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 hover:bg-blue-100"
        >
          Welcome! Track your IT onboarding and confirm your setup on <strong>My Onboarding</strong> →
        </Link>
      )}

      <div className={cardClass}>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            You haven&apos;t raised any IT tickets yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Ticket</th>
                  <th className="px-6 py-3 font-medium">Subject</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Priority</th>
                  <th className="px-6 py-3 font-medium">Submitted</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-3">
                      <Link
                        href={`/it/my-tickets/${t.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {t.ticket_number}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-800">{t.subject}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {(t.category_id && categoryNameById.get(t.category_id)) ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-600">
                      {formatDate(t.created_at)}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
