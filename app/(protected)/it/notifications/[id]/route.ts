import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Opening a notification marks it read, then goes to what it's about. RLS returns only the
// caller's own rows, so a foreign id just falls back to the inbox.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: notification } = await supabase
    .schema("it")
    .from("notifications")
    .select("id, link, read_at")
    .eq("id", id)
    .maybeSingle();

  if (notification && !notification.read_at) {
    await supabase
      .schema("it")
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  // Only ever redirect to an in-app path stored by our own triggers.
  const target = notification?.link?.startsWith("/") ? notification.link : "/it/notifications";
  return NextResponse.redirect(new URL(target, request.url));
}
