import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Modal } from "@/components/modal";
import { createTicket } from "./actions";
import { cardClass, inputClass, labelClass, primaryButtonClass } from "../../it/_components/ticket-ui";

export const HR_STATUS_TONE: Record<string, "positive" | "neutral" | "warning" | "info"> = {
  Open: "info",
  "In Progress": "warning",
  Resolved: "positive",
  Closed: "neutral",
};

const BASE_PATH = "/hr/tickets";

// IT module revision's button + Modal pattern (components/modal.tsx), applied outside IT for
// the first time — same recipe: searchParam trigger, key={Date.now()} on the panel so it can
// reopen after a close. Replaces the old always-rendered create form.
export default async function HrTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: account } = await supabase
    .from("user_accounts")
    .select("person_id")
    .eq("auth_user_id", user!.id)
    .maybeSingle();

  const [{ data: categories }, { data: tickets }] = await Promise.all([
    supabase.schema("hr").from("ticket_categories").select("id, name").eq("is_active", true).order("name"),
    supabase
      .schema("hr")
      .from("tickets")
      .select("id, subject, status, created_at")
      .eq("person_id", account?.person_id ?? "")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="py-6">
      <PageHeader
        title="HR Tickets"
        description="Submit a request or complaint to HR and track its progress."
        action={
          <Link href={`${BASE_PATH}?compose=new`} className={primaryButtonClass}>
            + Submit Ticket
          </Link>
        }
      />

      {sp.compose === "new" && (
        <Modal key={Date.now()} closeHref={BASE_PATH} title="Submit a Ticket">
          <form action={createTicket} className="space-y-4">
            <div>
              <label className={labelClass}>Category</label>
              <select name="categoryId" defaultValue="" className={inputClass}>
                <option value="">General</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Subject</label>
              <input name="subject" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea name="body" required rows={4} className={inputClass} />
            </div>
            <button type="submit" className={primaryButtonClass}>
              Submit Ticket
            </button>
          </form>
        </Modal>
      )}

      <div className={cardClass}>
        <div className="border-b border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-900">Your Tickets</p>
        </div>
        {(tickets ?? []).length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            You haven&apos;t submitted any tickets yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(tickets ?? []).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/hr/tickets/${t.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.subject}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusPill label={t.status} tone={HR_STATUS_TONE[t.status] ?? "neutral"} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
