import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME_PATH } from "@/lib/auth/roles";

export const getCurrentUserNav = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = user?.email ?? "";
  let roleName: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, role_id")
      .eq("id", user.id)
      .maybeSingle();

    displayName = profile?.display_name ?? user.email ?? "";

    if (profile?.role_id) {
      const { data: role } = await supabase
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle();
      roleName = role?.name ?? null;
    }
  }

  const homePath = roleName ? (ROLE_HOME_PATH[roleName] ?? "/home") : "/home";
  return { displayName, roleName, homePath };
});
