"use server";

import { createClient } from "@/lib/supabase/server";

// Backs the top-bar notification popover (components/notification-bell.tsx). IT is still the
// only module with an inbox (javaria_it_0003_notifications.sql) — same scope as
// layout.tsx's getUnreadNotificationCount, just also returning the most recent rows for the
// preview list instead of only a count. RLS returns only the caller's own notifications.
export type RecentNotification = {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

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
        .select("id, title, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(8),
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
