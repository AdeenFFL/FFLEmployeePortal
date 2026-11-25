"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Backs the top-bar notification popover (components/notification-bell.tsx). IT is still the
// only module with an inbox (javaria_it_0003_notifications.sql). The bell lists only what the
// person hasn't opened yet: opening one (/it/notifications/[id]) or ticking it off marks it read
// and it leaves the list. Everything, read or not, stays on /it/notifications. RLS returns only
// the caller's own notifications, and the column grant lets them change only read_at.
export type RecentNotification = {
  id: string;
  event: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  ticket_id: string | null;
  request_id: string | null;
  demand_id: string | null;
  invoice_id: string | null;
};

const BELL_LIMIT = 30;

export async function getRecentNotifications(): Promise<{
  notifications: RecentNotification[];
  unreadCount: number;
}> {
  try {
    const supabase = await createClient();
    const [{ data: notifications }, { count }] = await Promise.all([
      supabase
        .schema("it")
        .from("notifications")
        .select("id, event, title, body, read_at, created_at, ticket_id, request_id, demand_id, invoice_id")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(BELL_LIMIT),
      supabase
        .schema("it")
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
    ]);
    return { notifications: notifications ?? [], unreadCount: count ?? 0 };
  } catch {
    return { notifications: [], unreadCount: 0 };
  }
}

// Tick one off without opening it.
export async function markNotificationRead(id: string) {
  const supabase = await createClient();
  await supabase
    .schema("it")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  revalidatePath("/it/notifications");
}

// Clear the bell: everything unread becomes read.
export async function markAllRead() {
  const supabase = await createClient();
  await supabase
    .schema("it")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  revalidatePath("/it/notifications");
}
