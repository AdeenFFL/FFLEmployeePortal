"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/require-user";

// RLS ("notifications mark own read") limits this to the caller's own rows, and the column
// grant limits it to read_at.
export async function markAllNotificationsRead() {
  const { supabase, personId } = await requireActiveUser();
  await supabase
    .schema("it")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_person_id", personId)
    .is("read_at", null);
  revalidatePath("/", "layout");
}
