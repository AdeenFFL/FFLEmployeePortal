"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Password sign-in never touches app/auth/callback/route.ts (that's OAuth-only), so
// last_login_at would otherwise stay "Never" forever for password-auth accounts. No self-update
// RLS policy covers this column, so — same reason the OAuth callback needs it — this goes
// through the service-role client. Best-effort: swallows its own errors so it can never hang or
// fail the sign-in flow that calls it.
export async function recordPasswordLogin() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await createAdminClient()
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);
  } catch (error) {
    console.error("recordPasswordLogin failed", error);
  }
}
