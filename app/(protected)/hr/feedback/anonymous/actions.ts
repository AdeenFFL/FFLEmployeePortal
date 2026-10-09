"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-permission";

export async function replyToConversation(conversationId: string, formData: FormData) {
  const { supabase } = await requirePermission("hr.manage_anonymous_feedback");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Message cannot be empty.");

  // hr.reply_to_anonymous_conversation() is security-definer — it re-checks the caller is an
  // HRBP for this conversation's department itself (06-hr-module-design.md §3.1), so this is
  // belt-and-suspenders with the requirePermission() call above, not the only gate.
  const { error } = await supabase.schema("hr").rpc("reply_to_anonymous_conversation", {
    p_conversation_id: conversationId,
    p_body: body,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/hr/feedback/anonymous/${conversationId}`);
  revalidatePath("/hr/feedback/anonymous");
}
