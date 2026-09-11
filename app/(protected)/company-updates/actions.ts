"use server";

import { revalidatePath } from "next/cache";
import { requireHrOrAdmin } from "@/lib/auth/require-hr-or-admin";
import { requireActiveUser } from "@/lib/auth/require-user";
import { logAuditEvent } from "@/lib/audit/log";

const PATH = "/company-updates";
const OPTION_COUNT = 6;

export async function createOrUpdateAnnouncement(formData: FormData) {
  const { supabase, personId, actorLabel } = await requireHrOrAdmin();

  const id = String(formData.get("id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const is_pinned = formData.get("is_pinned") === "on";

  if (!title || !body) throw new Error("Title and body are required.");

  if (id) {
    const { error } = await supabase
      .from("announcements")
      .update({ title, body, is_pinned })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await logAuditEvent({
      supabase,
      actorId: personId,
      actorLabel,
      module: "company-updates",
      action: "MODIFIED",
      details: `Updated announcement '${title}'`,
    });
  } else {
    const { error } = await supabase
      .from("announcements")
      .insert({ title, body, is_pinned, created_by: personId });
    if (error) throw new Error(error.message);
    await logAuditEvent({
      supabase,
      actorId: personId,
      actorLabel,
      module: "company-updates",
      action: "CREATED",
      details: `Posted announcement '${title}'`,
    });
  }

  revalidatePath(PATH);
}

export async function deleteAnnouncement(id: string) {
  const { supabase, personId, actorLabel } = await requireHrOrAdmin();

  const { data: announcement } = await supabase
    .from("announcements")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "company-updates",
    action: "DELETED",
    details: `Deleted announcement '${announcement?.title ?? id}'`,
  });

  revalidatePath(PATH);
}

export async function createPoll(formData: FormData) {
  const { supabase, personId, actorLabel } = await requireHrOrAdmin();

  const question = String(formData.get("question") ?? "").trim();
  if (!question) throw new Error("Question is required.");

  const options: string[] = [];
  for (let i = 1; i <= OPTION_COUNT; i++) {
    const label = String(formData.get(`option_${i}`) ?? "").trim();
    if (label) options.push(label);
  }
  if (options.length < 2) throw new Error("At least 2 options are required.");

  const { data: poll, error: pollError } = await supabase
    .from("polls")
    .insert({ question, created_by: personId })
    .select("id")
    .single();
  if (pollError) throw new Error(pollError.message);

  const { error: optionsError } = await supabase.from("poll_options").insert(
    options.map((label, i) => ({ poll_id: poll.id, label, sort_order: i })),
  );
  if (optionsError) throw new Error(optionsError.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "company-updates",
    action: "CREATED",
    details: `Created poll '${question}' with ${options.length} options`,
  });

  revalidatePath(PATH);
}

export async function closePoll(id: string) {
  const { supabase, personId, actorLabel } = await requireHrOrAdmin();

  const { data: poll } = await supabase
    .from("polls")
    .select("question")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("polls").update({ status: "Closed" }).eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "company-updates",
    action: "MODIFIED",
    details: `Closed poll '${poll?.question ?? id}'`,
  });

  revalidatePath(PATH);
}

export async function deletePoll(id: string) {
  const { supabase, personId, actorLabel } = await requireHrOrAdmin();

  const { data: poll } = await supabase
    .from("polls")
    .select("question")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("polls").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    supabase,
    actorId: personId,
    actorLabel,
    module: "company-updates",
    action: "DELETED",
    details: `Deleted poll '${poll?.question ?? id}'`,
  });

  revalidatePath(PATH);
}

// No audit log entry — a routine end-user action, not an admin-module change, unlike everything
// else in this file. Any authenticated active user (all four roles) can vote.
export async function voteOnPoll(pollId: string, formData: FormData) {
  const { supabase } = await requireActiveUser();

  const optionId = String(formData.get("option_id") ?? "").trim();
  if (!optionId) throw new Error("Select an option to vote.");

  const { error } = await supabase.rpc("cast_poll_vote", {
    p_poll_id: pollId,
    p_option_id: optionId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}
