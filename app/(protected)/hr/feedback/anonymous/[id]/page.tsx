import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { replyToConversation } from "../actions";

export default async function AnonymousConversationThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .schema("hr")
    .from("anonymous_conversations")
    .select("id, status, created_at, department_org_unit_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  const { data: department } = await supabase
    .from("org_units")
    .select("name")
    .eq("id", conversation.department_org_unit_id)
    .maybeSingle();

  const { data: messages } = await supabase
    .schema("hr")
    .from("anonymous_messages")
    .select("id, sender_type, body, created_at")
    .eq("conversation_id", id)
    .order("created_at");

  const replyAction = replyToConversation.bind(null, id);

  return (
    <div className="py-6">
      <PageHeader
        title={department?.name ?? "Unknown department"}
        description={`Anonymous conversation · ${conversation.status}`}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-6 py-4">
          {(messages ?? []).map((m) => (
            <div
              key={m.id}
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.sender_type === "hr"
                  ? "self-end bg-blue-600 text-white"
                  : "self-start bg-slate-100 text-slate-800"
              }`}
            >
              <p>{m.body}</p>
              <p
                className={`mt-1 text-[10px] ${
                  m.sender_type === "hr" ? "text-blue-100" : "text-slate-400"
                }`}
              >
                {m.sender_type === "hr" ? "HR" : "Submitter"} ·{" "}
                {new Date(m.created_at).toLocaleString()}
              </p>
            </div>
          ))}
          {(messages ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No messages yet.</p>
          )}
        </div>

        {conversation.status !== "Closed" && (
          <form action={replyAction} className="border-t border-slate-200 p-4">
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Write a reply…"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Reply
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
