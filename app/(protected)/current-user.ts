import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME_PATH, ROLE_PRIORITY } from "@/lib/auth/roles";

export const getCurrentUserNav = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = user?.email ?? "";
  let roleName: string | null = null;

  if (user) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("person_id, email, persons(full_name)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    displayName = account?.persons?.full_name ?? account?.email ?? user.email ?? "";

    if (account?.person_id) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("person_id", account.person_id);

      const roleNames = (roleRows ?? []).map((r) => r.roles?.name).filter(Boolean) as string[];
      roleName = ROLE_PRIORITY.find((r) => roleNames.includes(r)) ?? roleNames[0] ?? null;
    }
  }

  const homePath = roleName ? (ROLE_HOME_PATH[roleName] ?? "/home") : "/home";
  return { displayName, roleName, homePath };
});
