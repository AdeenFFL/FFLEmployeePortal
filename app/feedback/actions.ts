"use server";

import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated anonymous feedback chat. Deliberately uses the service-role client
// for everything — see 06-hr-module-design.md §3.1: RLS on hr.anonymous_conversations/
// anonymous_messages stays deny-by-default for both `anon` and `authenticated` except the
// explicit HR-staff read policies, so a direct anon-role client query would get nothing anyway.
// "You may only touch the conversation whose token you supply" is enforced here, in code, by
// never accepting anything but the caller-supplied conversationId — there is no listing/
// enumeration endpoint, and no identity is ever written for the submitter side.

export async function listFeedbackDepartments() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("org_units")
    .select("id, name")
    .eq("type", "Department")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function startAnonymousConversation(departmentOrgUnitId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");
  if (!departmentOrgUnitId) throw new Error("Please choose a department.");

  const supabase = createAdminClient();
  const { data: conversation, error: conversationError } = await supabase
    .schema("hr")
    .from("anonymous_conversations")
    .insert({ department_org_unit_id: departmentOrgUnitId })
    .select("id")
    .single();
  if (conversationError) throw new Error(conversationError.message);

  const { error: messageError } = await supabase
    .schema("hr")
    .from("anonymous_messages")
    .insert({ conversation_id: conversation.id, sender_type: "submitter", body: trimmed });
  if (messageError) throw new Error(messageError.message);

  return conversation.id as string;
}

export async function sendAnonymousMessage(conversationId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");
  if (!conversationId) throw new Error("Missing conversation token.");

  const supabase = createAdminClient();

  // Scoped entirely by the token itself — if it doesn't match a real, open conversation, this
  // silently finds nothing to update and the insert below would orphan a message against a
  // conversation that doesn't exist, so check existence+status first.
  const { data: conversation } = await supabase
    .schema("hr")
    .from("anonymous_conversations")
    .select("id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) throw new Error("Conversation not found.");
  if (conversation.status === "Closed") throw new Error("This conversation has been closed.");

  const { error } = await supabase
    .schema("hr")
    .from("anonymous_messages")
    .insert({ conversation_id: conversationId, sender_type: "submitter", body: trimmed });
  if (error) throw new Error(error.message);
}

export async function getAnonymousConversation(conversationId: string) {
  if (!conversationId) return null;
  const supabase = createAdminClient();

  const { data: conversation } = await supabase
    .schema("hr")
    .from("anonymous_conversations")
    .select("id, status, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const { data: messages } = await supabase
    .schema("hr")
    .from("anonymous_messages")
    .select("id, sender_type, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at");

  return { conversation, messages: messages ?? [] };
}
