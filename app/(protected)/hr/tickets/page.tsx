import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { createTicket } from "./actions";

const STATUS_STYLES: Record<string, string> = {
  Open: "bg-blue-50 text-blue-700",
  "In Progress": "bg-amber-50 text-amber-700",
  Resolved: "bg-green-50 text-green-700",
  Closed: "bg-slate-100 text-slate-500",
};

export default async function HrTicketsPage() {
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
      />

      <form
        action={createTicket}
        className="mb-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
            <select
              name="categoryId"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">General</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <input
              name="subject"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea
            name="body"
            required
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Submit Ticket
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-900">Your Tickets</p>
        </div>
        {(tickets ?? []).length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            You haven't submitted any tickets yet.
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
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      STATUS_STYLES[t.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
