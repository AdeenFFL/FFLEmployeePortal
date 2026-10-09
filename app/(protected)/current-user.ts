import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { resolveHomePath } from "@/lib/auth/home-path";
import { getGrantedPermissionKeys } from "@/lib/auth/granted-permissions";

export const getCurrentUserNav = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = user?.email ?? "";
  let permissions = new Set<string>();

  if (user) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("person_id, email, persons(full_name)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    displayName = account?.persons?.full_name ?? account?.email ?? user.email ?? "";

    if (account?.person_id) {
      permissions = await getGrantedPermissionKeys(supabase, account.person_id);
    }
  }

  const homePath = resolveHomePath(permissions);
  return { displayName, permissions: [...permissions], homePath };
});
