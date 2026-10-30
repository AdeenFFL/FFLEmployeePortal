"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/require-permission";
import type { ItChecklistTaskType } from "@/types/database";

// Task-type owners — same shape as app/(protected)/it/settings/owners/actions.ts (category
// owners), applied to checklist task types instead. RLS on it.task_type_owners is what actually
// restricts writes (it.onboarding.assign); the action only requires that same permission.

const PATH = "/it/settings/onboarding-owners";

function go(kind: "error" | "notice", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  revalidatePath(PATH);
  go("notice", message);
}

export async function addTaskTypeOwner(taskType: ItChecklistTaskType, formData: FormData) {
  const { supabase } = await requirePermission("it.onboarding.assign");
  const personId = String(formData.get("personId") ?? "");
  const makePrimary = formData.get("primary") === "on";
  if (!personId) go("error", "Pick a person.");

  if (makePrimary) {
    const { error: clearError } = await supabase
      .schema("it")
      .from("task_type_owners")
      .update({ is_primary: false })
      .eq("task_type", taskType)
      .eq("is_primary", true);
    if (clearError) go("error", clearError.message);
  }

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .insert({ task_type: taskType, person_id: personId, is_primary: makePrimary })
    .select("person_id");
  if (error) {
    go("error", error.code === "23505" ? "Already an owner of this task type." : error.message);
  }
  if (!data?.length) go("error", "Only someone who can assign onboarding tasks can do that.");

  done(makePrimary ? "Primary owner set. New tasks of this type auto-assign to them." : "Owner added.");
}

export async function setPrimaryTaskTypeOwner(taskType: ItChecklistTaskType, personId: string) {
  const { supabase } = await requirePermission("it.onboarding.assign");

  const { error: clearError } = await supabase
    .schema("it")
    .from("task_type_owners")
    .update({ is_primary: false })
    .eq("task_type", taskType)
    .eq("is_primary", true);
  if (clearError) go("error", clearError.message);

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .update({ is_primary: true })
    .eq("task_type", taskType)
    .eq("person_id", personId)
    .select("person_id");
  if (error) go("error", error.message);
  if (!data?.length) go("error", "Only someone who can assign onboarding tasks can do that.");

  done("Primary owner changed.");
}

export async function removeTaskTypeOwner(taskType: ItChecklistTaskType, personId: string) {
  const { supabase } = await requirePermission("it.onboarding.assign");

  const { data, error } = await supabase
    .schema("it")
    .from("task_type_owners")
    .delete()
    .eq("task_type", taskType)
    .eq("person_id", personId)
    .select("person_id");
  if (error) go("error", error.message);
  if (!data?.length) go("error", "Only someone who can assign onboarding tasks can do that.");

  done("Owner removed.");
}
